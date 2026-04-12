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
# Current versions
node -e "import('./packages/argue/package.json',{with:{type:'json'}}).then(m=>console.log('argue:',m.default.version))"
node -e "import('./packages/argue-cli/package.json',{with:{type:'json'}}).then(m=>console.log('argue-cli:',m.default.version))"

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

Also check which packages have changes:

```bash
LAST_TAG=$(git tag -l 'v*' --sort=-v:refname | head -1)
if [ -n "$LAST_TAG" ]; then
  git diff --name-only "$LAST_TAG"..HEAD -- packages/argue/src
  git diff --name-only "$LAST_TAG"..HEAD -- packages/argue-cli/src
else
  echo "No previous tag — both packages are new"
fi
```

## Step 2 — Decide Version Bump

Based on the commits gathered above, determine the semver bump:

| Commit pattern                            | Bump      |
| ----------------------------------------- | --------- |
| `fix:` / `perf:` / `refactor:` only       | **patch** |
| Any `feat:`                               | **minor** |
| `BREAKING CHANGE` in body or `!:` in type | **major** |

Both packages share one version number. Pick the highest bump level across all commits.

Present the decision to the user:

> Current version: X.Y.Z
> Commits since last release: (count)
> Suggested bump: patch/minor/major -> X.Y.Z
> Packages with changes: argue / argue-cli / both
>
> Proceed?

Wait for confirmation. The user may override the version.

## Step 3 — Update Versions

```bash
node scripts/bump-version.mjs X.Y.Z
npm install
```

This updates `version` in both package.json files and the CLI dependency on `@onevcat/argue`.

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

After push, GitHub Actions will automatically detect the tag and publish changed packages to npm.

## Troubleshooting

- **CI publishes wrong packages**: The workflow compares local `package.json` versions against npm registry. If a package version already exists on npm, it skips that package.
- **Tag already exists**: If you need to redo a release, delete the tag locally and remotely (`git tag -d vX.Y.Z && git push --delete origin vX.Y.Z`), fix the issue, then re-tag.
