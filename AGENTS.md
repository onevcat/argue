# AGENTS.md

## Scope

This file applies to the whole `argue` repository.

## Repo Overview

This repository is a monorepo with two independently released npm packages:

- `@onevcat/argue`: reusable library
- `@onevcat/argue-cli`: CLI host

The CLI depends on the library through a real semver dependency in `packages/argue-cli/package.json`.

## Local Development

Use normal monorepo development flow for day-to-day work:

```bash
npm install
npm run dev
```

Useful commands:

- `npm run check`: workspace typecheck
- `npm run test`: workspace tests
- `npm run build`: workspace build
- `npm run ci`: `check + test + build`
- `npm run smoke:pack`: tarball install smoke tests for both packages
- `npm run release:check`: `ci + smoke:pack`
- `npm run lint`: ESLint across repo
- `npm run format:check`: Prettier validation
- `npm run format`: format repo

Recommended daily loop:

1. `npm install`
2. make code changes
3. `npm run test`
4. `npm run release:check` before merging changes that affect packaging, dependency shape, or CLI installability

## Package Development Rules

Treat the repo as one workspace during implementation, but treat the packages as separate products during versioning and publishing.

### Library-only changes

If the change only affects `@onevcat/argue` and does not require CLI dependency updates:

- update code under `packages/argue`
- bump only `packages/argue/package.json` when releasing

### CLI-only changes

If the change only affects `@onevcat/argue-cli`:

- update code under `packages/argue-cli`
- bump only `packages/argue-cli/package.json` when releasing

### Coordinated library + CLI changes

If CLI needs new library behavior:

1. update library code
2. bump `packages/argue/package.json`
3. update CLI code
4. bump `packages/argue-cli/package.json`
5. update `packages/argue-cli/package.json` dependency on `@onevcat/argue`
6. run `npm install`
7. run `npm run release:check`

## Dependency Rule

Do not change the CLI dependency back to local-only references such as:

- `file:`
- `workspace:`

`@onevcat/argue-cli` must always depend on `@onevcat/argue` through a real semver range so the published tarball remains installable outside this repo.

## Release Process

Reference doc:

- `docs/release.md`

Workflow:

- GitHub Actions workflow: `.github/workflows/release.yml`
- Manual trigger only
- One package per run

Release order:

- if publishing only library: publish `argue`
- if publishing only CLI: publish `argue-cli`
- if both are needed and CLI depends on the new library release:
  1. publish `argue`
  2. publish `argue-cli`

Pre-flight checklist:

```bash
npm install
npm run release:check
```

## Packaging Validation

`npm run smoke:pack` validates:

- `@onevcat/argue` can be packed, installed, and imported in a fresh temp project
- `@onevcat/argue-cli` can be packed, installed with the packed library, and execute `argue --version`

If package metadata, dependency wiring, or bin entry changes, run this command.

## Init Command

For this repository, the practical equivalent of `/init` is:

```bash
node packages/argue-cli/dist/cli.js config init --local
```

This creates `./argue.config.json` in the repo root when missing.

## Documentation Rules

- Root `README.md` is the main human-facing documentation.
- Package README files should stay minimal and point back to the repo README.
- Release process details belong in `docs/release.md`.

## Pre-PR Checklist

Before creating a pull request, always run the full local CI pipeline and ensure it passes:

```bash
npm run ci            # typecheck + test + build
npm run format:check  # prettier validation
```

Do not push or open a PR if either command fails.

## Notes For Future Changes

- Keep `@onevcat/argue-cli --version` derived from package metadata instead of hardcoded strings.
- Keep CI validating packaging through `npm run smoke:pack`.
- If release automation changes, update both `.github/workflows/release.yml` and `docs/release.md`.
