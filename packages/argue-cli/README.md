# argue-cli

CLI host skeleton for the `argue` engine.

## Usage (current skeleton)

```bash
argue run --config ./argue.config.json
```

Current behavior validates config path and prints host wiring TODOs.

Next steps:

- wire runtime adapters (claude / codex / mock)
- map adapter execution into `AgentTaskDelegate`
- invoke `ArgueEngine.start()` with loaded config
