# Argue Troubleshooting

## Common Errors

| Error                             | Cause                                   | Fix                                                                                                                                            |
| --------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelNotFoundError`              | Model ID doesn't exist or is misspelled | Check model IDs match what the provider supports exactly. Use the model ID from your provider's docs, not a version alias.                     |
| `SIGKILL` / process killed        | Exec timeout too short                  | Increase timeout to 600s minimum. Use `--per-task-timeout-ms` and `--per-round-timeout-ms` for fine-grained control.                           |
| Agent eliminated (error)          | Agent crashed during debate             | Check `events.jsonl` for per-agent errors. Common causes: wrong model ID, CLI not authenticated, rate limit hit.                               |
| `minimum participant requirement` | Not enough agents completed             | Usually means one agent errored out. Check `events.jsonl` for per-agent errors. Verify both CLIs work standalone first.                        |
| Config not found                  | Wrong config path                       | Default: `~/.config/argue/config.json`. Project-local: `./argue.config.json`. Use `--config` flag to specify custom path.                      |
| CLI not found                     | Provider CLI not on PATH                | Ensure `codex`, `gemini`, etc. are installed and accessible. Run `which <cli>` to verify.                                                      |
| `summary.md` missing              | Debate killed before completion         | `summary.md` only writes on successful completion. `events.jsonl` is written live and always available. Parse it directly for partial results. |
| Rate limit errors                 | API throttling                          | Reduce `--max-rounds` or use `--per-task-timeout-ms` to increase per-task timeout. CLI-based providers handle rate limits internally.          |

## Output Path Behavior

Output directory depends on which config file argue loads:

- **Global config** (`~/.config/argue/config.json`): outputs to `~/.argue/output/<requestId>/`
- **Project-local config** (`./argue.config.json`): outputs to `./out/<requestId>/`

Override with `--jsonl`, `--result`, `--summary` flags.

## Debugging Tips

1. **Use `--verbose` while learning or debugging** to see agent reasoning, claims, and votes in real-time. Skip it for quieter output.
2. **Use `--trace --trace-level full`** for protocol-level debugging if agents aren't responding.
3. **Check `events.jsonl`** for the full event stream — includes per-round details and error traces.
4. **Check `result.json`** for structured output including final status, scores, and claim resolutions.
5. **Verify CLI auth separately** — run each provider CLI standalone before using it in argue:
   ```bash
   codex "Hello, respond with OK"
   gemini "Hello, respond with OK"
   ```
6. **Start simple** — 2 agents, 2-3 rounds, then increase complexity if needed.

## Performance Notes

- 2 agents × 3 rounds ≈ 3-5 minutes (CLI-based providers)
- 2 agents × 3 rounds ≈ 2-4 minutes (API-based providers, no CLI overhead)
- Adding more agents increases time roughly linearly
- Complex topics with long responses may need `--per-task-timeout-ms 120000` or higher
- Network issues with API providers can cause intermittent agent failures — retry usually works
- Use `--token-budget` to cap per-agent token usage for faster debates on constrained topics
- Use `--global-deadline-ms` to enforce a hard deadline across the entire debate
