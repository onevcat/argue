# Release Automation Design

## Goal

Replace manual `workflow_dispatch` releases with an agent-driven local flow that:
1. Analyzes commits, decides version bump, updates package metadata
2. Generates/appends CHANGELOG.md
3. Tags and pushes — GitHub Actions handles npm publish on tag push

## Architecture

```
Local (agent + skill)              Remote (GitHub Actions)
┌──────────────────────┐           ┌─────────────────────┐
│ /release skill       │  git push │ on: push tags: v*   │
│                      │  + tag    │                     │
│ LLM-driven:          │ ────────> │ Deterministic:      │
│  - version decision  │           │  - npm ci           │
│  - changelog gen     │           │  - release:check    │
│                      │           │  - detect changed   │
│ Scripted:            │           │    packages         │
│  - update pkg.json   │           │  - npm publish      │
│  - npm install       │           │                     │
│  - release:check     │           │                     │
│  - commit + tag      │           │                     │
└──────────────────────┘           └─────────────────────┘
```

## Components

### 1. Release Skill — `.claude/skills/release.md`

A Claude Code skill invoked via `/release`. Guides the agent through:

1. **Gather context**: read current versions from both `package.json` files, list commits since last `v*` tag (or all commits if no tag exists)
2. **Decide scope**: which packages changed (lib only / cli only / both)
3. **Decide version**: based on conventional commit types:
   - `fix:` → patch
   - `feat:` → minor
   - `BREAKING CHANGE` / `!:` → major
   - When both packages change, they share the same version number
4. **Update versions**: bump `packages/argue/package.json`, `packages/argue-cli/package.json`, and the CLI dependency on the library (`^x.y.z`)
5. **Generate changelog**: prepend a new section to root `CHANGELOG.md` grouped by commit type
6. **Validate**: run `npm install && npm run release:check`
7. **Commit**: single commit `release: vX.Y.Z`
8. **Tag**: `git tag vX.Y.Z`
9. **Push**: `git push && git push --tags`

### 2. GitHub Workflow — `.github/workflows/release.yml`

Triggered by tag push (`v*`). Replaces the current `workflow_dispatch` trigger.

Steps:
1. Checkout at the tag ref
2. `npm ci && npm run release:check`
3. For each package, compare the version in `package.json` against what's currently published on npm (`npm view <pkg> version`). If the local version is newer, publish it.
4. Publish order: library first, then CLI (sequential jobs or steps)

Keep `workflow_dispatch` with `dry_run: true` as a validation-only fallback (no publish).

### 3. CHANGELOG.md

Root-level file. Format:

```markdown
# Changelog

## [0.1.0] - 2026-04-11

### Features
- feat description (#PR or commit hash)

### Fixes
- fix description (#PR or commit hash)

### Other
- chore/refactor/etc description
```

Grouped by version (newest first), then by type within each version.

### 4. Tag Convention

- Single tag `vX.Y.Z` per release (e.g., `v0.1.0`)
- Both packages use the same version number
- The workflow detects which packages actually changed and only publishes those

### 5. docs/release.md Update

Update to reflect the new tag-driven flow and `/release` skill usage.

## Decisions

- **Shared version**: both packages share one version to keep things simple. A single `v*` tag covers both.
- **No separate release branches**: releases happen from `master`.
- **Agent decides, human confirms**: the skill presents the version bump and changelog for review before committing.
- **Changelog is LLM-generated**: the agent reads commits and writes human-friendly descriptions, not just raw commit messages.

## Files Changed

| File | Action |
|------|--------|
| `.claude/skills/release.md` | Create — release skill |
| `.github/workflows/release.yml` | Modify — tag trigger + auto-detect |
| `CHANGELOG.md` | Create — initial changelog |
| `docs/release.md` | Update — new flow documentation |
