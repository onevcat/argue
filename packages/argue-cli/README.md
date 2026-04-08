# argue-cli

CLI host skeleton for the `argue` engine.

## Run

```bash
argue run [--config <path>] [--jsonl <path>]
```

Current behavior:

- loads and validates config
- resolves output paths
- prints wiring summary (runtime adapter and delegate wiring still TODO)

## Config location

When `--config` is omitted, lookup order is:

1. `./argue.config.json`
2. `~/.config/argue/config.json`

## Config shape (v1)

Top-level fields:

- `schemaVersion: 1`
- `providers: Record<string, Provider>`
- `agents: Agent[]` (at least 2)
- optional `output`, `defaults`

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

Example config:

- `packages/argue-cli/examples/config.example.json`
