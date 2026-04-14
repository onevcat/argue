# AGENTS.md

## Scope

This file applies to the whole `argue` repository.

## Repo Overview

This repository is a monorepo with three workspace packages under **unified versioning** — root `package.json` holds the canonical version and every package carries the same number:

- `@onevcat/argue`: reusable library (published)
- `@onevcat/argue-cli`: CLI host (published)
- `@onevcat/argue-viewer`: result viewer web app (private, `private: true`, never published)

The CLI depends on the library through a real semver dependency in `packages/argue-cli/package.json`. The viewer also consumes `@onevcat/argue` through a real semver range so its local build graph matches published reality.

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

Viewer-only shortcuts (for frontend iteration without rebuilding the library/CLI):

- `npm run dev:viewer`: start the viewer Vite dev server
- `npm run build:viewer`: build the viewer only
- `npm run check:viewer`: typecheck the viewer only
- `npm run test:viewer`: run the viewer test suite only

Recommended daily loop:

1. `npm install`
2. make code changes
3. `npm run test`
4. `npm run release:check` before merging changes that affect packaging, dependency shape, or CLI installability

## Package Development Rules

All workspace packages share one version. Do not bump packages individually — every release bumps root + every `packages/*/package.json` together and `@onevcat/argue-cli` / `@onevcat/argue-viewer` always depend on the exact same `@onevcat/argue` version.

Workflow for any change that will be released:

1. Update code under whichever packages are affected (`packages/argue`, `packages/argue-cli`, `packages/argue-viewer`)
2. Run `node scripts/bump-version.mjs X.Y.Z` — bumps root and every package, and rewrites internal `@onevcat/argue` deps
3. Run `npm install`
4. Run `npm run release:check`

Day-to-day edits that are not yet releasing do not need a version bump — just work on the code.

## Dependency Rule

Do not change the CLI dependency back to local-only references such as:

- `file:`
- `workspace:`

`@onevcat/argue-cli` must always depend on `@onevcat/argue` through a real semver range so the published tarball remains installable outside this repo.

## Release Process

Reference doc:

- `docs/release.md`

Workflow:

- GitHub Actions:
  - `.github/workflows/ci.yml` runs typecheck + tests + build on every PR and push to `master`.
  - `.github/workflows/release.yml` publishes on tag push.
- Triggered on `v*` tag push (one tag = one unified release)
- Publishes `@onevcat/argue` then `@onevcat/argue-cli` in a single run
- `@onevcat/argue-viewer` stays private and is never published

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
npm run build                                   # required: builds dist/cli.js
node packages/argue-cli/dist/cli.js config init --local
```

This creates `./argue.config.json` in the repo root when missing.

## Viewer Deployment

`@onevcat/argue-viewer` is deployed to **Cloudflare Pages**. The build output `packages/argue-viewer/dist/` is published as a static site; client-side routes (`/example`, `/report`) rely on SPA fallback via `packages/argue-viewer/public/_redirects`. Do not remove that file, and do not introduce host-specific config for other platforms (Vercel, Netlify, etc.) without updating this section.

## Documentation Rules

- Root `README.md` is the main human-facing documentation.
- Published packages (`@onevcat/argue`, `@onevcat/argue-cli`) keep a minimal README that points back to the repo README. `@onevcat/argue-viewer` is private and intentionally has no README.
- Release process details belong in `docs/release.md`.
- Architecture decision records live under `docs/adr/` (numbered, append-only).
- Implementation plans for larger features live under `docs/plan/`.

## Git Hooks

The repo uses husky + lint-staged to enforce quality automatically:

- **pre-commit**: `lint-staged` runs `prettier --write` + `eslint --fix` on staged files (~2.7s)
- **pre-push**: full `check + test + build` (~13s)

Run `npm install` after cloning to activate hooks (husky `prepare` script).

## Pre-PR Checklist

Before creating a pull request, always run the full local CI pipeline and ensure it passes:

```bash
npm run format:check  # prettier validation
npm run lint          # eslint
npm run ci            # typecheck + test + build
```

The pre-push hook runs `check + test + build` automatically, but `format:check` and `lint` must also pass. Do not push or open a PR if any command fails.

## Notes For Future Changes

- Keep `@onevcat/argue-cli --version` derived from package metadata instead of hardcoded strings.
- Keep CI validating packaging through `npm run smoke:pack`.
- If release automation changes, update both `.github/workflows/release.yml` and `docs/release.md`.
