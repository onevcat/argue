---
name: release
description: Prepare and publish a new release — bump versions, generate changelog, tag, and push for CI to publish to npm.
---

# Release

Prepare and ship a new version of argue packages.

## Pre-conditions

- Working tree is clean (`git status` shows no uncommitted changes)
- You are on the `master` branch
- All CI checks pass locally (`npm run ci && npm run format:check`)

If any pre-condition fails, fix it before proceeding. Do NOT skip checks.

## Step 1 — Gather Context

Run these commands and record the output:

```bash
# Current unified version (root is the source of truth)
node -e "import('./package.json',{with:{type:'json'}}).then(m=>console.log('workspace:',m.default.version))"

# Last release tag
git tag -l 'v*' --sort=-v:refname | head -1

# Commits since last tag (or all if no tag)
LAST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -1)
if [ -n "$LAST_TAG" ]; then
  git log "$LAST_TAG"..HEAD --oneline
else
  git log --oneline
fi
```

## Step 2 — Decide Version Bump

Based on the commits gathered above, determine the semver bump:

| Commit pattern                            | Bump      |
| ----------------------------------------- | --------- |
| `fix:` / `perf:` / `refactor:` only       | **patch** |
| Any `feat:`                               | **minor** |
| `BREAKING CHANGE` in body or `!:` in type | **major** |

All workspace packages share one version number. Pick the highest bump level across all commits.

Present the decision to the user:

> Current version: X.Y.Z
> Commits since last release: (count)
> Suggested bump: patch/minor/major -> X.Y.Z
>
> Proceed?

Wait for confirmation. The user may override the version.

## Step 3 — Update Versions

```bash
node scripts/bump-version.mjs X.Y.Z
npm install
```

This updates `version` in the root `package.json` and every `packages/*/package.json`, and rewrites `@onevcat/argue-cli` and `@onevcat/argue-viewer`'s internal dependency on `@onevcat/argue` to `^X.Y.Z`.

## Step 4 — Generate Changelog

Read the current `CHANGELOG.md` (create if it doesn't exist). Prepend a new section at the top (after the `# Changelog` heading).

Format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Features

- description of feat commit (short-hash)

### Fixes

- description of fix commit (short-hash)

### Other

- description of chore/refactor/docs/etc commit (short-hash)
```

Rules:

- Write **human-friendly descriptions**, not raw commit messages. Rewrite for clarity.
- Omit empty sections (e.g., if no fixes, skip "### Fixes").
- Include the short commit hash in parentheses.
- Merge commits (like "Merge pull request #N") should be skipped — use the underlying commits instead.
- Keep the rest of the file unchanged.

## Step 5 — Validate

```bash
npm run release:check
```

This runs typecheck + tests + build + smoke pack. If it fails, fix the issue before proceeding.

## Step 6 — Commit, Tag, Push

```bash
git add -A
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```

After push, GitHub Actions detects the tag and publishes both `@onevcat/argue` and `@onevcat/argue-cli` to npm. `argue-viewer` is `private: true` and stays local.

## Step 7 — Create GitHub Release

Publish the GitHub Release page for the freshly pushed tag, using the changelog section generated in Step 4 as the release notes:

```bash
node scripts/publish-github-release.mjs
```

The script reads the version from root `package.json`, extracts the topmost `## [X.Y.Z] - ...` section from `CHANGELOG.md`, verifies its heading matches the version being released, and runs `gh release create vX.Y.Z --title vX.Y.Z --notes <section>`. You can also pass an explicit version: `node scripts/publish-github-release.mjs X.Y.Z`.

Notes:

- This step is independent from npm publishing; it's safe to run immediately after `git push --tags`, even before the npm workflow finishes.
- If the release already exists (e.g. retrying), the script will fail with `Release.tag_name already exists`. To overwrite, delete it first via `gh release delete vX.Y.Z --yes` and re-run, or update notes manually with `gh release edit vX.Y.Z --notes-file <(awk '/^## \[/{n++; if(n==2)exit} n==1{print}' CHANGELOG.md)`.

## Troubleshooting

- **Tag already exists**: If you need to redo a release, delete the tag locally and remotely (`git tag -d vX.Y.Z && git push --delete origin vX.Y.Z`), fix the issue, then re-tag.
- **Publish fails on second package**: The workflow publishes `@onevcat/argue` first and then `@onevcat/argue-cli`. If the CLI publish fails after the lib already went out, bump to the next patch and re-release — the lib publish step is idempotent (npm rejects duplicate versions, which is fine).
