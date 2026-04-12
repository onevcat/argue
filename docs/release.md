# Release

This repository uses **unified versioning** across the whole workspace. Every package carries the same version number:

- `@onevcat/argue` (published)
- `@onevcat/argue-cli` (published)
- `@onevcat/argue-viewer` (private, not published)

The root `package.json` holds the canonical version. A single tag (`vX.Y.Z`) drives one release that publishes both npm packages together.

## Quick Release

Run the `/release` skill in Claude Code. It handles everything:

1. Analyzes commits since last tag
2. Suggests a semver bump (patch / minor / major)
3. Updates the version across root + all `packages/*`
4. Generates / updates `CHANGELOG.md`
5. Validates with `npm run release:check`
6. Commits, tags (`vX.Y.Z`), and pushes

GitHub Actions picks up the tag and publishes both packages to npm via OIDC trusted publishing.

## Manual Release

If you need to release without the skill:

1. Run `node scripts/bump-version.mjs X.Y.Z` — updates root, lib, cli, viewer, and both internal `@onevcat/argue` deps
2. Run `npm install` — sync the lockfile
3. Update `CHANGELOG.md`
4. Run `npm run release:check`
5. Commit: `git commit -m "release: vX.Y.Z"`
6. Tag: `git tag vX.Y.Z`
7. Push: `git push && git push --tags`

## How Publishing Works

- GitHub Actions workflow: `.github/workflows/release.yml`
- Triggers on `v*` tag push
- Validates (`release:check` + CLI dependency shape) then publishes `@onevcat/argue` followed by `@onevcat/argue-cli`
- Uses OIDC trusted publishing (no token management needed)
- `argue-viewer` is `private: true` and is never published

The workflow can also be triggered manually via `workflow_dispatch` for dry-run validation (no publish).
