# Release

This repository publishes two independent npm packages:

- `@onevcat/argue`
- `@onevcat/argue-cli`

The CLI depends on `@onevcat/argue` through a real semver dependency. Both packages share the same version number.

## Quick Release

Run the `/release` skill in Claude Code. It handles everything:

1. Analyzes commits since last tag
2. Suggests a semver bump (patch / minor / major)
3. Updates all `package.json` versions
4. Generates / updates `CHANGELOG.md`
5. Validates with `npm run release:check`
6. Commits, tags (`vX.Y.Z`), and pushes

GitHub Actions picks up the tag and publishes changed packages to npm via OIDC trusted publishing.

## Manual Release

If you need to release without the skill:

1. Bump versions in `packages/argue/package.json` and `packages/argue-cli/package.json`
2. Update CLI dependency on `@onevcat/argue` to `^X.Y.Z`
3. Run `npm install`
4. Update `CHANGELOG.md`
5. Run `npm run release:check`
6. Commit: `git commit -m "release: vX.Y.Z"`
7. Tag: `git tag vX.Y.Z`
8. Push: `git push && git push --tags`

## How Publishing Works

- GitHub Actions workflow: `.github/workflows/release.yml`
- Triggers on `v*` tag push
- For each package, compares local version against npm registry
- Publishes only packages whose version is newer
- Uses OIDC trusted publishing (no token management needed)
- Library is always published before CLI

The workflow can also be triggered manually via `workflow_dispatch` for dry-run validation (no publish).

## Release Order

Since both packages share a version, a single tag covers both. The workflow publishes library first, then CLI, skipping any package whose version already exists on npm.
