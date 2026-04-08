# argue-cli

CLI host skeleton for the `argue` engine.

## Usage (current skeleton)

```bash
argue run --config ./argue.config.json --jsonl ./out/run.events.jsonl
```

Current behavior validates config path and prints host wiring TODOs (including JSONL path).

Next steps:

- wire runtime adapters (claude / codex / mock)
- map adapter execution into `AgentTaskDelegate`
- invoke `ArgueEngine.start()` with loaded config
