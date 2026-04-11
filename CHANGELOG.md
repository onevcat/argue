# Changelog

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
