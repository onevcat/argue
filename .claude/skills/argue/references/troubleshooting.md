# Argue Troubleshooting

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ModelNotFoundError` | Model ID doesn't exist or is misspelled | Check model IDs match exactly what the provider supports (e.g., `gemini-3.1-pro-preview`, not `gemini-3.1-pro-preview-05-06`). Verify with `codex --version` / `gemini --version`. |
| `SIGKILL` / process killed | Exec timeout too short | Increase timeout to 600s minimum. 2 agents × 3 rounds = 3-7 min. More agents or rounds need more time. |
| Agent eliminated (error) | Agent crashed during debate | Check `events.jsonl` for per-agent errors. Common causes: wrong model ID, CLI not authenticated, rate limit hit. |
| `minimum participant requirement` | Not enough agents completed | Usually means one agent errored out. Check `events.jsonl` for per-agent errors. Verify both CLIs work standalone first. |
| Config not found | Wrong config path | Default: `~/.config/argue/config.json`. Project-local: `./argue.config.json`. Use `--config` flag to specify custom path. |
| CLI not found | Provider CLI not on PATH | Ensure `codex`, `gemini`, etc. are installed and accessible. Run `which <cli>` to verify. |
| `summary.md` missing | Debate killed before completion | `summary.md` only writes on successful completion. `events.jsonl` is written live and always available. Parse it directly for partial results. |
| Rate limit errors | API throttling | Add `--timeout-ms` to agent config for retries, or reduce `--max-rounds`. Consider using CLI-based providers which handle rate limits internally. |

## Debugging Tips

1. **Always use `--verbose`** to see agent reasoning, claims, and votes in real-time
2. **Check `events.jsonl`** for the full event stream — includes per-round details and error traces
3. **Check `result.json`** for structured output including final scores and consensus details
4. **Verify CLI auth separately** — run each provider CLI standalone before using it in argue:
   ```bash
   codex "Hello, respond with OK"
   gemini "Hello, respond with OK"
   ```
5. **Start simple** — 2 agents, 2-3 rounds, then increase complexity if needed
6. **Use `--trace`** for detailed protocol-level debugging if agents aren't responding

## Performance Notes

- 2 agents × 3 rounds ≈ 3-5 minutes (CLI-based providers)
- 2 agents × 3 rounds ≈ 2-4 minutes (API-based providers, no CLI overhead)
- Adding more agents increases time roughly linearly
- Complex topics with long responses may need 600s+ timeout
- Network issues with API providers can cause intermittent agent failures — retry usually works
- Use `--token-budget` to cap per-agent token usage for faster debates on constrained topics