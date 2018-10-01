## Release History

* 3.1.0 Add cache group support

* 3.0.0 Use latest rollup by using our own rollup-stream

  Please update the options you pass to rollup, particularly: `entry` → `input`, and
  `{globals, format, exports, sourceMap}` → `output.{globals, format, exports, sourcemap}`

* 2.2.1 Pin rollup-stream to avoid breaking rollup-plugin-multi-entry

* 2.2.0 Add `skipCache` option for specifying targets that should not use rollup's cache.

* 2.1.1 Upgrade rollup to pick up memory leak fix in https://github.com/rollup/rollup/pull/1470.

* 2.1.0 Allow for the passing of an error handler. Re-run tasks that fail on first run on any
  subsequent change until they succeed.

* 2.0.0 Name output buffers after the targets and don't swallow errors.

* 1.0.1 Expose `task` as a public function.

* 1.0.0 Initial release.
