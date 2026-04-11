# Release

This repository publishes two independent npm packages:

- `@onevcat/argue`
- `@onevcat/argue-cli`

The CLI depends on `@onevcat/argue` through a real semver dependency. If a CLI change requires a newer library version, release the library first, then bump the CLI dependency, then release the CLI.

## Pre-flight

1. Update the target package version in its `package.json`.
2. If releasing `@onevcat/argue-cli`, verify `dependencies["@onevcat/argue"]` points to the intended published semver range.
3. Run:

```bash
npm install
npm run release:check
```

`release:check` runs typecheck, tests, build, and tarball smoke tests:

- `@onevcat/argue` can be installed and imported in a fresh project
- `@onevcat/argue-cli` can be installed together with the packed library and execute `argue --version`

## Publish

Use the GitHub Actions workflow `Release`. Choose one package per run:

- `argue`: publishes `packages/argue`
- `argue-cli`: publishes `packages/argue-cli`

The workflow is `workflow_dispatch` only and expects:

- default branch code already merged
- `NPM_TOKEN` configured in repository secrets

## Recommended order

Library only release:

1. Bump `packages/argue/package.json`
2. Run `npm install`
3. Run `npm run release:check`
4. Merge
5. Trigger `Release` with `package=argue`

CLI release without library dependency change:

1. Bump `packages/argue-cli/package.json`
2. Run `npm install`
3. Run `npm run release:check`
4. Merge
5. Trigger `Release` with `package=argue-cli`

Coordinated library + CLI release:

1. Bump `packages/argue/package.json`
2. Bump `packages/argue-cli/package.json`
3. Bump `packages/argue-cli` dependency on `@onevcat/argue`
4. Run `npm install`
5. Run `npm run release:check`
6. Merge
7. Trigger `Release` with `package=argue`
8. After publish completes, trigger `Release` with `package=argue-cli`
