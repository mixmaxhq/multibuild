'use strict';

const _ = require('underscore');
const rollup = require('@mixmaxhq/rollup-stream');
const runSequence = require('run-sequence');
const buffer = require('vinyl-source-buffer');

// Sentinel value to detect the default cache.
const DEFAULT_CACHE = Object.create(null);

const identity = (v) => v;

/**
 * Coalesce the given value to a Map, and transform each value with the given iteratee.
 *
 * @param {?Map|Object} value The value to convert to a Map.
 * @return {Map} The produced map. If the value was a Map, we return a shallow copy.
 */
function toMap(value, iteratee=identity) {
  if (!value) {
    return new Map();
  }
  const entries = value instanceof Map ? value : Object.entries(value);
  return new Map(entries.map(([key, value]) => [key, iteratee(value)]));
}

/**
 * Builds multiple ES6 module bundles and rebuilds bundles as files change.
 *
 * Initialize a multibuild, then call `runAll`. This will build all target bundles and register
 * dependencies on the files that comprise each bundle. Then, as files change, call `changed`:
 *
 * ```js
 * const build = new MultiBuild(...);
 * gulp.watch('src/**', (event) => build.changed(event.path));
 * ```
 *
 * Bundles that include that file will be rebuilt.
 */
class MultiBuild {
  /**
   * @param {Object} options
   *  @param {Gulp} gulp - The gulp instance with which to register build tasks.
   *  @param {Array<String>} targets - The names of the targets to build, arbitrary identifiers.
   *    Must not contain spaces since they will be used to form the names of the build tasks.
   *  @param {Map<String,Set<String>|String[]>|Object<String,Set<String>|String[]>} cacheGroups The
   *    mapping of cache group specifiers to target names. This segments the cached modules per-
   *    group, which can help ensure that module IDs which resolve differently depending on target
   *    don't poison the cache for other targets.
   *  @param {Array<String>} [skipCache] - Names of targets that should not use rollup's cache, eg
   *    because they are processed differently than other targets. Defaults to [].
   *  @param {Function} input - A function that returns the Rollup entry point when invoked with a
   *    target.
   *  @param {Object|Function=} rollupOptions - Options to pass to Rollup's `rollup` and `generate`
   *    methods, or a function that returns such options when invoked with a target.
   *  @param {Function} output - A function that will be invoked with a target and a readable stream
   *    containing the bundled JS as a Vinyl buffer, ready for piping through further transformations
   *    or to disk. The buffer will be given the filename `${target}.js` (you may of course rename).
   *    The function should return the final stream.
   *  @param {Function} [errorHandler] - Handler for errors emitted by `rollup-stream`. If this
   *    option is omitted, emitted errors will be thrown.
   */
  constructor(options) {
    this._gulp = options.gulp;

    // The names of the targets.
    this._targets = options.targets;
    this._targetsSet = new Set(options.targets);

    // Targets that should not use a cache.
    this._skipCacheMap = new Set(options.skipCache || []);

    // The mapping from cache group specifiers (names) to targets.
    this._cacheGroups = toMap(options.cacheGroups || undefined, (v) => new Set(v));

    // The mapping from targets to cache group specifiers (names).
    this._targetCacheGroups = new Map();

    // Ensure no target belongs to multiple cache groups, and determine the target => cache group
    // mapping from the cache group => target mapping.
    const discards = [];
    for (const [group, targets] of this._cacheGroups) {
      for (const target of targets) {
        if (!this._targetsSet.has(target)) {
          // We track the discards separately to avoid messing with the cacheGroups iterator.
          discards.push([group, target]);
          continue;
        }
        if (this._targetCacheGroups.has(target)) {
          const otherGroup = this._targetCacheGroups.get(target);
          throw new Error(`there must be a 1-many mapping between groups and targets, but target ${target} was assigned to both ${group} and ${otherGroup}`);
        }
        this._targetCacheGroups.set(target, group);
      }
    }

    // Remove groups with non-existent targets.
    for (const [group, target] of discards) {
      const groupTargets = this._cacheGroups.get(group);
      if (groupTargets.size) {
        groupTargets.delete(target);
        if (!groupTargets.size) {
          this._cacheGroups.delete(group);
        }
      }
    }

    // If there are any targets with no explicit cache group, then add the default cache group.
    let defaultGroup;
    for (const target of this._targets) {
      if (this._targetCacheGroups.has(target)) continue;
      if (defaultGroup) {
        defaultGroup.add(target);
      } else {
        defaultGroup = new Set([target]);
        this._cacheGroups.set(DEFAULT_CACHE, defaultGroup);
      }
    }

    // Groups of cached modules from rollup.
    this._caches = new Map();

    // Map targets to the modules they include so we can conditionally rebuild.
    this._targetDependencyMap = {};

    this._registerTasks(options);
  }

  /**
   * Get all the task group specifiers.
   *
   * @return {String[]} The names of the task groups.
   */
  taskGroups() {
    return [...this._cacheGroups.keys()].map(MultiBuild.taskGroup);
  }

  /**
   * Builds all target bundles and registers dependencies on the files that comprise each bundle.
   *
   * @param {Function} done - Callback.
   */
  runAll(done) {
    // We run the groups in parallel, but each target tasks within a group sequentially, so that
    // each run can benefit from the cached AST from the previous runs.
    runSequence.use(this._gulp)(this.taskGroups(), done);
  }

  /**
   * Builds all target bundles and registers dependencies on the files that comprise each bundle.
   *
   * @param {Function} done - Callback.
   */
  runAllSequential(done) {
    // We support running the groups sequentially, in case the build fares better with less
    // cross-group contention, but run each target task within a group sequentially, so that each
    // run can benefit from the cached AST from the previous runs.
    runSequence.use(this._gulp)(...this.taskGroups(), done);
  }

  /**
   * Rebuilds bundles dependent on the specified file, if any, as determined by a previous build
   * e.g. an invocation of `runAll`.
   *
   * @param {String} path - The path of the file that changed.
   */
  changed(path) {
    const changedTargetTasks = _.filter(this._targets, (target) => {
      /**
       * Tasks that have not yet run successfully will not be registered in `_targetDependencyMap`,
       * which means that we won't know their dependencies. We always run these tasks on a file
       * change until they succeed once and we get their dependencies, otherwise they will never be
       * run after their first failure.
       */
      if (!_.has(this._targetDependencyMap, target)) {
        return true;
      }

      const dependencies = this._targetDependencyMap[target];
      return dependencies && dependencies.has(path);
    }).map(MultiBuild.task);

    if (!_.isEmpty(changedTargetTasks)) {
      // Run the target tasks sequentially, so that each run can benefit from the cached AST from
      // the previous runs--this appears faster in some local testing. It's also not safe to run in
      // parallel with the latest Rollup until https://github.com/rollup/rollup/issues/1010 is fixed.
      runSequence.use(this._gulp)(...changedTargetTasks);
    }
  }

  /**
   * Get or initialize the cache for the given target.
   *
   * @param {String} target The target to cache.
   * @param {Boolean=} init Whether to store the new cache object, if we made one.
   * @return {Object} The cache object (containing a modules object).
   */
  _getCache(target, {init=false}={}) {
    const hasGroup = this._targetCacheGroups.has(target);
    const group = hasGroup ? this._targetCacheGroups.get(target) : DEFAULT_CACHE;
    let cache = this._caches.get(group);
    if (!cache) {
      cache = {
        modules: {}
      };
      if (init) {
        this._caches.set(group, cache);
      }
    }
    return cache;
  }

  /**
   * Registers the target build tasks with Gulp.
   *
   * @param {Object} options - The options passed to `MultiBuild`'s constructor.
   */
  _registerTasks(options) {
    // Register the target groups so we can parallelize this work.
    for (const [group, targets] of this._cacheGroups) {
      this._gulp.task(MultiBuild.taskGroup(group), (done) => {
        runSequence.use(this._gulp)(...[...targets].map(MultiBuild.task), done);
      });
    }

    this._targets.forEach((target) => {
      const skipCache = this._skipCacheMap.has(target);
      this._gulp.task(MultiBuild.task(target), () => {
        const rollupOptions = _.defaults({
          input: options.input(target),
        }, skipCache ? {} : {
          /**
           * We depend partially on undocumented behavior. The cache option technically contains a
           * bundle, and we're assuming based on current behavior that it only extracts the cached
           * AST from the old bundle. See
           * https://github.com/rollup/rollup/blob/5c0597d70a4a0800bd320d20a229050d73c6daac/src/Bundle.js#L22.
           */
          cache: {
            modules: _.values(this._getCache(target).modules)
          }
        }, _.isFunction(options.rollupOptions) ? options.rollupOptions(target) : options.rollupOptions);

        return options.output(
          target,
          rollup(rollupOptions)
            .on('error', function(e) {
              if (options.errorHandler) {
                this.emit('end');
                options.errorHandler(e);
              } else {
                throw e;
              }
            })
            .on('bundle', (bundle) => {
              // Reset the dependencies in case we've removed some imports.
              this._targetDependencyMap[target] = new Set();

              const cache = !skipCache && this._getCache(target, {init: true});
              for (const module of bundle.modules) {
                this._targetDependencyMap[target].add(module.id);
                if (!skipCache) {
                  cache.modules[module.id] = module;
                }
              }
            })
            .pipe(buffer(`${target}.js`))
        );
      });
    });
  }

  /**
   * Returns the name of the given group.
   *
   * @param {*} group
   * @return {String} The gulp task name
   */
  static taskGroup(group) {
    return group === DEFAULT_CACHE ? 'jsdefaultgroup' : `jsgroup:${group}`;
  }

  /**
   * Returns the name of the task corresponding to the specified target.
   *
   * @param {String} target
   * @return {String} task
   */
  static task(target) {
    return `js:${target}`;
  }
}

module.exports = MultiBuild;
