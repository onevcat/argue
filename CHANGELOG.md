# Changelog

## [0.4.0] - 2026-04-15

Headline: reasoning passthrough for CLI providers, plus a more resilient JSON recovery path. `argue-cli` now forwards per-model and per-agent reasoning settings to Claude Code and Codex, and a new syntax-only fallback in `parseJsonObject` rescues debate rounds where `jsonrepair` would otherwise give up on CJK output with stray ASCII quotes.

### Features

- `argue-cli` now accepts `defaults.participantsPolicy`, `--min-participants`, and `--on-insufficient-participants` so users can choose whether participant shortfall yields a structured `interrupted` result or preserves legacy hard-failure behavior via `fail`
- `argue-cli` now forwards per-model and per-agent `reasoning` settings to Claude Code and Codex so CLI-backed providers can opt into reasoning modes via config (3689783)

### Fixes

- Recover debate rounds where agents emit CJK strings with unescaped ASCII quotes around phrases like `"弱客观性"（...`. `jsonrepair`'s lookahead misclassifies these as unquoted keys; `parseJsonObject` now has a syntax-only position-driven stray-quote escape fallback that walks `JSON.parse`'s error position and escapes the most recent offending quote, retrying until the parser accepts the payload (f857b54)
- `perTaskTimeoutMs` now defaults to `perRoundTimeoutMs` instead of a fixed value, so per-round and per-task budgets stay aligned unless explicitly overridden (3531cff)
- Provider error messages now include captured stdout alongside stderr so failed CLI agent invocations are easier to diagnose (ccc448b)
- Codex provider invocations pass `--skip-git-repo-check` so `argue` can run outside git repositories (ccc448b)

### Other

- Add migration notes across README / README_CN / README_JP / argue skill docs for the new `interrupted` semantics, including how to keep old behavior with `onInsufficientParticipants: "fail"`
- Add consumer-path coverage for `interrupted` in CLI and viewer tests so the new status ships with same-batch documentation and UI verification
- Document where the CLI reasoning passthrough is a no-op (non-supporting models) and clarify user responsibility for supplying valid values (a3a22c7)
- Sync the reasoning passthrough section into `README_CN.md` and `README_JP.md` (14700d1)
- Clarify in `runtime/json` doc comments that the stray-quote fallback is syntax-only and that schema enforcement stays in `normalizeTaskOutput` (74700bb)

## [0.3.1] - 2026-04-14

### Fixes

- `argue view --no-open` now prints the full report URL on stdout instead of a truncated preview, so `$(argue view --no-open)` and `| pbcopy` pipelines work as expected (ab39ef9)

## [0.3.0] - 2026-04-14

Headline: `argue view` lands. Open any past run's report directly in the browser — from the CLI, from a `--view` flag on `argue run`, or by visiting a shareable URL that carries the result in its fragment. Also: a new `argue` skill for Claude Code, viewer UX polish, and collision-resistant request IDs.

### Features

- `argue view` command: open a past run's report in the browser by request ID or latest run (1352ba0)
- `argue run --view`: launch the viewer automatically after a run finishes (4e5fba9)
- Encode `result.json` into a viewer URL fragment via gzip + base64url so reports load without a backend (20875a4)
- Cross-platform browser launcher for `argue view` (50dba68) and orchestrator that wires discovery, encoding, and launch together (683ce0e)
- Run discovery helpers for locating past runs on disk (75a70f3)
- `viewer.url` config field, defaulting to `https://argue.onev.cat` (285cc42)
- Collision-resistant `requestId` generator used for all new runs (26dc754, f689518)
- Viewer auto-loads the report from the URL fragment on startup (f8c83f2, 8ea37b9)
- Viewer routes the example report under `/example` with browser back/forward support (c017626)
- Viewer renders agent prose with markdown emphasis (6a77eb6)
- Viewer persists round merge events and gains chain-merge replay coverage (ca3d61d)
- New `argue` skill for Claude Code so agents can run debates through the CLI (dfad285)

### Fixes

- Require HTTPS for `viewer.url` except loopback addresses (7c50024)
- Tighten `REQUEST_ID_PATTERN` to match the generator exactly and unify `argue view` discovery on it (f4e8b96, 1ab2bec)
- Truncate long report URLs in terminal output to avoid log spam (50cc4cd)
- Fix merge replay handling in the engine (d70460b)
- Viewer: wrap hash decoder failures in descriptive errors (310d1c5)
- Viewer: snapshot the URL hash before async decode to avoid a race (cd5227e)
- Viewer: pin `Uint8Array` buffer type for strict tsc check (57e9ca4)
- Address argue skill self-review findings and follow-up review feedback (6b4f584, 42a7608)

### Other

- Document `argue view`, `--no-open`, and default viewer URL across README, CLI help, and package docs (c9eacfc, b12f4fd, 106a7bf, dbd6782)
- Add "Install the Argue Skill" and "Live Demo" sections to the root README (5e70681, b315d0e)
- Refresh README epigraph quotes and tease the manual route (1cadc34)
- Tighten the argue skill docs and point at `result.ts` instead of bundling the schema (d3d15e8, 9cfee65)
- `chore(release)`: publish GitHub Release page automatically from CHANGELOG (cdf6bd1)
- Refactors: share default output dir helper, reuse loaded config in `argue view`, make `launchBrowser` async (dbd6782, 6141df3, 59ebd35)

## [0.2.0] - 2026-04-13

First release under **unified versioning**: `@onevcat/argue`, `@onevcat/argue-cli`, and `@onevcat/argue-viewer` now share one version number driven by the root `package.json`. Headline change: `@onevcat/argue-viewer` is real — a Preact web app that renders an `ArgueResult` JSON file as a readable dossier.

### Features

- Introduce `@onevcat/argue-viewer` as a Preact web app that renders `ArgueResult` JSON into a readable dossier (1847ec9)
- Split viewer into landing / report screens with round polish and a shared footer (e354d3c)
- Viewer header now shows the debate date; judgements are aligned and confidence toned down (35f4c77)
- Replace viewer vote pills with Lucide check / x icon badges (324e153)
- Self-host viewer fonts and add component tests (32c3038)
- Carry the debate task title through `ArgueResult` so the viewer can display it (52ebc18)
- Add a `resultVersion` field to `ArgueResult` for forward-compatible schema evolution (58672e9)

### Fixes

- Use Web Crypto `randomUUID` in the engine so `@onevcat/argue` works in browser environments (12d40fd, #41)
- Repair broken JSON and persist raw model output on parse failure in the CLI runner (cc31bf6)
- Exclude `@onevcat/argue` from viewer `optimizeDeps` so the alias to `result.ts` actually wins (e53f361)
- Treat a missing `resultVersion` as version 1 in the viewer (55094e0)
- Center stance and vote-chip text in the viewer (7a0808b)
- Viewer code review follow-ups and a new `formatTimestamp` helper (3cb4c2a)

### Other

- Adopt unified workspace versioning: root `package.json` is now the source of truth, `scripts/bump-version.mjs` propagates to every workspace package, and the release workflow publishes `@onevcat/argue` + `@onevcat/argue-cli` on one tag (#44)
- Replace the CLI's hand-written JSON repair with the `jsonrepair` library (1d4969c)
- Editorial dossier redesign + borderless parchment pass for the viewer (c8fffe8, 458e66d)

## [0.1.1] - 2026-04-12

### Fixes

- Fix same-round claim ID collisions when multiple agents produce claims simultaneously (851cf93)

### Other

- Engine now assigns claim IDs centrally; agents no longer self-assign (8753f2e)
- Add husky + lint-staged for automatic pre-commit and pre-push quality checks (6202de3)
- Document git hooks and update pre-PR checklist (9a68a97)

## [0.1.0] - 2026-04-11

Initial release of `@onevcat/argue` and `@onevcat/argue-cli`.

### Features

- Core orchestration engine with multi-agent debate protocol and rubric scoring (066bed5)
- Phase-aware prompt templates with structured output schemas (5767be9)
- JSONL observer for streaming structured event logs (9815d2a)
- Round event emission from task settlement timeline (d70ce3b)
- Action system: define, execute, and output standalone actions via library and CLI (3453379, 2cae9e3, 554c0c1, e1f7d8b)
- Session continuity for CLI and API providers across rounds (d168cd3)
- JSON config schema, loader, and `config init` command with idempotent behavior (1422b57, f2258b9, 8096a74)
- `config add-provider` and `config add-agent` commands with `--agent` shortcut (90c2d90, 46aafd0)
- Vendor presets and auto-injected CLI base args for first-party agent support (429b885)
- First-party CLI support for Claude, Copilot, Gemini, Codex, Pi, OpenCode, Droid, and Amp (7c8d6dd, f8b7d59)
- Headless CLI runner with real-time round progress streaming (b60af62, ed09cb2)
- Rich CLI output with colors, per-agent details, verbose mode, and stance breakdowns (5717bab, e7dd981, 1be4414)
- Structured summary report with comprehensive sections (be3ba37, abe9c3e)
- Error artifact output on run failure (e4a7e64)
- `respondedAt` timestamps and report events (e3750b0)
- `exports` field in both package.json files for modern resolution (fb23969)
- Semantic validation for CLI numeric arguments (75b6938)
- `--agent` shortcut defaults to representative composer (46aafd0)
- Tag-driven GitHub Actions publish workflow (398befd)

### Fixes

- Preserve multiline action output in CLI instead of truncating (ff6211b)
- Reject non-object patches in `MemorySessionStore` (0988ede)
- Add bounded default (10) for `maxPeersPerRound` (b0bf9bd)
- Validate `representativeId` for representative composer (6e29d41)
- Bound API message history with sliding window (70cee65)
- Validate missing API key environment variable (1f5a66a)
- Wrap API `generateText` errors with retryability context (9b060b8)
- Correct action runtime normalization and context handling (a5edafa)
- Use `--resume` for subsequent Claude CLI rounds (8bd8761)
- Fix CLI base args for real Claude and Codex binaries (9d96edf)

### Other

- Monorepo split into `@onevcat/argue` library and `@onevcat/argue-cli` packages (687f1c8)
- Collapse `topic`/`objective` into single `task` input (261b970)
- Remove TUI mode from plan and implementation (a569482)
- Add LICENSE to packages and switch to OIDC trusted publishing (844ecb1)
- ESLint and Prettier configuration with CI fail-fast checks (c29bcef)
- Dev watch mode with concurrently (50da5af)
