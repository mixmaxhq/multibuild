# multibuild

Let's say that you're developing [an email platform](https://mixmax.com/). You use a rich text
editor in a lot of views&mdash;the email editor itself, the signature editor, the template
editor&mdash;and you'd like to reuse that component between them without bundling all of the
view-specific JavaScript together.

If you factor your codebase using [ES6 modules](https://strongloop.com/strongblog/an-introduction-to-javascript-es6-modules/), you can have per-view "entry" scripts that import that
component and other view-specific modules. A tool like [Rollup](http://rollupjs.org/) can then produce
per-view bundles that only include the JavaScript used by each view. But how do you coordinate this
multi-target build process?

That's where multibuild comes in. It builds related ES6 module bundles using gulp and rollup, and
then rebuilds them as files change.

multibuild benefits:

* Modules are cached between build targets
  * Modules IDs can be flagged to bypass resolution caching for target-derived aliasing
* Only affected targets are rebuilt when a file changes
* Bundling is simpler and more consistent

Even if you don't have multiple views in your application, multibuild can still be used to
simultaneously build your application bundle and your test bundle.

## Installation

```
$ npm install multibuild
```
or
```
$ npm install multibuild --save
```

## Usage

```js
var gulp = require('gulp');
var multiEntry  = require('rollup-plugin-multi-entry');
var MultiBuild = require('multibuild');
var rename = require('gulp-rename');

var build = new MultiBuild({
  // The Gulp instance with which to register the build tasks.
  gulp,

  // The targets to build, arbitrary identifiers. Can't contain spaces since they'll be used to
  // form the names of the build tasks.
  targets: [
    'app',
    'legacy-app',
    'app-vendor',
    'spec'
  ],

  // Names of targets that should not use rollup's cache, eg  because they are processed differently
  // than other targets.
  //
  // Defaults to [].
  skipCache: [
    'spec'
  ],

  // Object/Map that specifies groups of targets which should share cache artifacts. Defaults to
  // sharing the cache between all targets. Targets not specified here will use a default cache
  // group, so you can add new cache groups separate from most other targets.
  cacheGroups: {
    // app-vendor uses rollup-plugin-alias, which would otherwise pollute the build cache with the
    // contents of some aliased modules from this target. Without this cache group, that code would
    // get used in other targets despite the alias not being specified for them.
    vendored: [
      'app-vendor'
    ]
  },

  // Don't cache the resolved path of these module IDs. This lets you do fun things with aliasing
  // and conditionally changing the resolved module based on bundle, without losing the benefits of
  // caching across multiple targets.
  skipResolveCache: ['jquery'],

  /**
   * Optional handler for rollup-emitted errors. We allow the passing of an error handler instead of
   * conditionally applying `gulp-plumber` because `gulp-plumber` is incompatible with
   * `rollup-stream` per https://github.com/Permutatrix/rollup-stream/issues/1.
   */
  errorHandler(e) {
    if (process.env.NODE_ENV !== 'production') {
      // Keep watching for changes on failure.
      console.error(e);
    } else {
      // Throw so that gulp exits.
      throw(e);
    }
  },

  // A function that returns the Rollup entry point when invoked with a target.
  entry: (target) => (target === 'spec') ? 'spec/**/*.js' : `src/js/main-${target}.js`,

  // Options to pass to Rollup's `rollup` and `generate` methods, or a function that returns such
  // options when invoked with a target. Default: {}
  rollupOptions: (target) => {
    var options = {
      plugins: [],
      format: 'iife',
      exports: 'none'
    };
    if (target === 'spec') {
      // multi-entry lets us include all the test specs without having to explicitly import them
      // in a single `main-spec.js` script.
      options.plugins.push(multiEntry({exports: false}));

      // Additional processing done here (eg target-specific transpilation) may entice you to use the `skipCache` option.
    }
    return options;
  },

  // A function that will be invoked with a target and a readable stream containing the bundled JS
  // as a Vinyl buffer, ready for piping through further transformations or to disk. The buffer will
  // be given the filename `${target}.js` (you may of course rename). The function should return the
  // final stream.
  output: (target, input) => {
    if (target === 'spec') {
      return input
        .pipe(rename('spec.js'))
        .pipe(gulp.dest('./spec'));
    } else {
      return input
        .pipe(rename(`build-${target}.js`))
        .pipe(gulp.dest('./src'));
    }
  }
});

// Builds all target bundles and registers dependencies on the files that comprise each bundle.
// Alternatively, you can use build.runAllSequential to run the build groups in series. This
// sometimes yields performance gains, and sometimes performance losses. It likely depends on the
// overlap of work done by the different groups, as that may lead to disk contention.
gulp.task('js', (cb) => build.runAll(cb));

gulp.task('watch', function() {
  // Rebuild bundles that include the file that changed.
  gulp.watch(['src/js/**/*.js'], (event) => build.changed(event.path));
});

gulp.task('default', ['js', 'watch']);
```

You can get the name of a task generated for a target with `MultiBuild.task`. This can be useful for specifying MultiBuild-generated build tasks as dependencies of your other tasks without having to hard-code the task name.
```js
var generatedTaskName = MultiBuild.task('targetName');
```

## Contributing

We welcome pull requests! Please lint your code using the JSHint configuration in this project.
