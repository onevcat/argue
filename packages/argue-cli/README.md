# argue-cli

CLI host skeleton for the `argue` engine.

## Run

```bash
argue run [--config <path>] [--input <path>] [--agents a,b,c]
          [--topic <text>] [--objective <text>] [--request-id <id>]
          [--jsonl <path>] [--result <path>]
          [--min-rounds <n>] [--max-rounds <n>] [--threshold <0..1>]
          [--composer builtin|representative] [--representative-id <id>]
          [--trace] [--trace-level compact|full]
          [--language <lang>] [--token-budget <n>]
```

Current behavior:

- loads and validates config + optional input JSON
- resolves final run plan using precedence rules
- prints resolved plan summary (runtime adapter wiring still TODO)

## Precedence

`CLI flags > input JSON (--input) > config defaults`

## Config location

When `--config` is omitted, lookup order is:

1. `./argue.config.json`
2. `~/.config/argue/config.json`

## Config shape (`schemaVersion: 1`)

Top-level fields:

- `providers: Record<string, Provider>`
- `agents: Agent[]` (at least 2)
- optional `defaults`, `output`

Provider kinds:

- API provider
  - `type: "api"`
  - `protocol: "openai-compatible" | "anthropic-compatible"`
  - optional `baseUrl`, `apiKeyEnv`, `headers`
  - `models: Record<string, ProviderModel>`
- CLI provider
  - `type: "cli"`
  - `cliType: "codex" | "claude" | "generic"`
  - `command`, optional `args`, optional `env`
  - `models: Record<string, ProviderModel>`

Agent fields:

- `id`
- `provider` (must exist in `providers`)
- `model` (must exist in selected provider `models`)
- optional `role`, `systemPrompt`, `timeoutMs`, `temperature`

Defaults fields (optional):

- `defaultAgents: string[]`
- `minRounds`, `maxRounds`
- `perTaskTimeoutMs`, `perRoundTimeoutMs`, `globalDeadlineMs`
- `consensusThreshold`
- `composer`, `representativeId`
- `includeDeliberationTrace`, `traceLevel`
- `language`, `tokenBudgetHint`

Output fields (optional):

- `jsonlPath` (supports `{requestId}` placeholder)
- `resultPath` (supports `{requestId}` placeholder)

## Input JSON shape (`--input`)

Run-specific fields:

- `requestId`, `topic`, `objective`
- `agents`
- round / timeout / consensus / report policy overrides
- `language`, `tokenBudgetHint`, `context`

This file is for one run, while config holds the reusable provider/agent catalog.

## Examples

- config: `packages/argue-cli/examples/config.example.json`
- run input: `packages/argue-cli/examples/topic.example.json`
