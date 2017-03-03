"use strict";

var _ = require('underscore');
var plumber = require('gulp-plumber');
var rollup = require('rollup-stream');
var runSequence = require('run-sequence');
var buffer = require('vinyl-source-buffer');

/**
 * Builds multiple ES6 module bundles and rebuilds bundles as files change.
 *
 * Initialize a multibuild, then call `runAll`. This will build all target bundles and register
 * dependencies on the files that comprise each bundle. Then, as files change, call `changed`:
 *
 *   var build = new MultiBuild(...);
 *   gulp.watch('src/**', (event) => build.changed(event.path));
 *
 * Bundles that include that file will be rebuilt.
 */
class MultiBuild {
  /**
   * @param {Object} options
   *  @param {Gulp} gulp - The gulp instance with which to register build tasks.
   *  @param {Array<String>} targets - The names of the targets to build, arbitrary identifiers.
   *    Must not contain spaces since they will be used to form the names of the build tasks.
   *  @param {Function} entry - A function that returns the Rollup entry point when invoked with a
   *    target.
   *  @param {Object|Function=} rollupOptions - Options to pass to Rollup's `rollup` and `generate`
   *    methods, or a function that returns such options when invoked with a target.
   *  @param {Function} output - A function that will be invoked with a target and a readable stream
   *    containing the bundled JS as a Vinyl buffer, ready for piping through further transformations
   *    or to disk. The buffer will be given the filename `${target}.js` (you may of course rename).
   *    The function should return the final stream.
   */
  constructor(options) {
    this._gulp = options.gulp;

    // The names of the targets.
    this._targets = options.targets;

    // Cache parsed modules from rollup.
    this._cache = { modules: {} };

    // Map targets to the modules they include so we can conditionally rebuild.
    this._targetDependencyMap = {};

    this._registerTasks(options);
  }

  /**
   * Builds all target bundles and registers dependencies on the files that comprise each bundle.
   *
   * @param {Function} done - Callback.
   */
  runAll(done) {
    // We run the target tasks sequentially, so that each run can benefit from the cached AST from
    // the previous runs.
    var targetTasks = this._targets.map(MultiBuild._task);
    runSequence.use(this._gulp).apply(undefined, targetTasks.concat(done));
  }

  /**
   * Rebuilds bundles dependent on the specified file, if any, as determined by a previous build
   * e.g. an invocation of `runAll`.
   *
   * @param {String} path - The path of the file that changed.
   */
  changed(path) {
    var changedTargetTasks = _.filter(this._targets, (target) => {
      var dependencies = this._targetDependencyMap[target];
      return dependencies && dependencies.has(path);
    }).map(MultiBuild._task);

    if (!_.isEmpty(changedTargetTasks)) {
      // Run the target tasks sequentially, so that each run can benefit from the cached AST from
      // the previous runs--this appears faster in some local testing. It's also not safe to run in
      // parallel with the latest Rollup until https://github.com/rollup/rollup/issues/1010 is fixed.
      runSequence.use(this._gulp).apply(undefined, changedTargetTasks);
    }
  }

  /**
   * Registers the target build tasks with Gulp.
   *
   * @param {Object} options - The options passed to `MultiBuild`'s constructor.
   */
  _registerTasks(options) {
    this._targets.forEach((target) => {
      this._gulp.task(MultiBuild._task(target), () => {
        // Reset the dependencies in case we've removed some imports.
        var targetDependencies = this._targetDependencyMap[target] = new Set();

        var rollupOptions = _.defaults({
          entry: options.entry(target),

          // We depend partially on undocumented behavior. The cache option technically contains a bundle,
          // and we're assuming based on current behavior that it only extracts the cached AST from the
          // old bundle. See
          // https://github.com/rollup/rollup/blob/5c0597d70a4a0800bd320d20a229050d73c6daac/src/Bundle.js#L22.
          cache: {
            modules: _.values(this._cache.modules)
          }
        }, _.isFunction(options.rollupOptions) ? options.rollupOptions(target) : options.rollupOptions);

        return options.output(
            target,
            rollup(rollupOptions)
              .on('bundle', (bundle) => {
                bundle.modules.forEach((module) => {
                  targetDependencies.add(module.id);
                  this._cache.modules[module.id] = module;
                });
              })
              .pipe(plumber())
              .pipe(buffer(`${target}.js`))
          );
      });
    });
  }

  /**
   * Returns the name of the task corresponding to the specified target.
   *
   * @param {String} target
   * @return {String} task
   */
  static _task(target) {
    return `js:${target}`;
  }
}

module.exports = MultiBuild;
