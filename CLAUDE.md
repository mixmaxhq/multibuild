# multibuild — repo card

> A map, not a manual. Keep it ~1 screen; point to detail, don't inline it.

## What it is

A published npm helper (`multibuild`, MIT) that builds multiple related ES6-module bundles from one gulp setup, driving rollup once per named target and sharing/segmenting rollup's module cache across targets for fast incremental rebuilds. Exports a single `MultiBuild` class.

## serves

role: gulp/rollup multi-bundle build helper — register a `MultiBuild` with targets + a rollup config, call `runAll()`, and call `changed(path)` on file changes to rebuild only affected targets.
referenced-by: [mixmax-sdk-js, backbone-publication]

## Code map

- Everything (the `MultiBuild` class) -> index.js
- Public entry points: `runAll` / `runAllSequential` / `changed` -> index.js
- Static task-name helpers: `MultiBuild.task` / `MultiBuild.taskGroup` -> index.js

## Conventions

- Package manager: npm (package-lock.json, lockfileVersion 2). No `packageManager` field.
- Test framework: none — `test` script is a placeholder (`exit 1`); `ci` runs `lint` only.
- Lint/format: ESLint (`eslint-config-mixmax`) + Prettier (`@mixmaxhq/prettier-config`).
- Build: none — plain CommonJS, single `index.js`; `files` publishes only `index.js`.
- CI: Jenkins via `Jenkinsfile` (`npmModulePipeline` from the `scm-service-library` shared library). No GitHub Actions.
- Publish: npm, through the Jenkins `npmModulePipeline`. Public (not `private`).
- Deps kept current by Renovate (`local>mixmaxhq/renovate-config`).

## Run / test

- Install: `npm install`
- Lint: `npm run lint` (or `npm run ci`)
- No unit tests exist; `npm test` intentionally fails.

## Load the matching domain card

- Cross-cutting library — load the consuming capability's card, not a domain-* for this repo.
