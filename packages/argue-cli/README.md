# argue-cli

Official CLI host for the `argue` engine.

## Run

```bash
argue run [--config <path>] [--input <path>] [--agents a,b,c]
          [--task <text>] [--request-id <id>]
          [--jsonl <path>] [--result <path>] [--summary <path>]
          [--min-rounds <n>] [--max-rounds <n>] [--threshold <0..1>]
          [--composer builtin|representative] [--representative-id <id>]
          [--trace] [--trace-level compact|full]
          [--language <lang>] [--token-budget <n>]
```

Current behavior:

- loads and validates config + optional input JSON
- resolves final run plan using precedence rules
- executes `ArgueEngine.start()` end-to-end
- writes `result.json`, `events.jsonl`, and `summary.md`
- supports `mock`, `cli`, `api`, and `sdk` providers in headless mode

## Runtime decisions

- `type="api"` provider will use **AI SDK** as default implementation path.
- `type="sdk"` loads an adapter module and calls it in-process.
- provider/model mapping remains `logical model id -> providerModel` to keep config stable.

## Precedence

`CLI flags > input JSON (--input) > config defaults`

## Config location

When `--config` is omitted, lookup order is:

1. `./argue.config.json`
2. `~/.config/argue/config.json`

## Config shape (`schemaVersion: 1`)

Top-level fields:

- `providers: Record<string, Provider>` (`api` / `cli` / `sdk` / `mock`)
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
- SDK provider
  - `type: "sdk"`
  - `adapter` (local module path or package name)
  - optional `exportName`, optional `env`, optional `options`
  - `models: Record<string, ProviderModel>`
- Mock provider
  - `type: "mock"`
  - optional `defaultBehavior`
  - optional per-participant phase overrides
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
- `summaryPath` (supports `{requestId}` placeholder)

## Input JSON shape (`--input`)

Run-specific fields:

- `requestId`, `task`
- `agents`
- round / timeout / consensus / report policy overrides
- `language`, `tokenBudgetHint`, `context`

This file is for one run, while config holds the reusable provider/agent catalog.

## Provider notes

- `cliType="codex"` / `cliType="claude"`:
  - stdin receives a rendered prompt with task context and expected JSON schema
  - stdout can be raw JSON or wrapped in extra text / fenced code block; CLI will extract the first JSON object
- `cliType="generic"`:
  - stdin receives a JSON envelope `{ version, agent, task }`
  - stdout can be either an `AgentTaskResult` JSON object or the bare round/report content JSON
- `type="sdk"`:
  - adapter module should export `createArgueSdkAdapter` by default
  - the factory receives `{ providerName, provider, resolvePath, environment }`
  - `provider.env` is merged into `process.env` and passed as `environment`
  - adapter `runTask(args)` receives the same merged `environment`
  - `argue-cli` exports `CliSdkProviderAdapter`, `CreateCliSdkProviderAdapter`, and `ProviderTaskRunnerArgs` types
- `type="mock"`:
  - intended for CI and local validation
  - can simulate deterministic success, timeout, error, and malformed output per participant/phase

## Examples

- config: `packages/argue-cli/examples/config.example.json`
- run input: `packages/argue-cli/examples/task.example.json`
