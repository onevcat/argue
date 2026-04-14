# Argue Troubleshooting

## Common Errors

| Error                                           | Cause                                                 | Fix                                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unknown model 'X' for provider 'Y'`            | Agent's `model` is not in the provider's `models` map | Check the agent's `model` field matches a key in the provider's `models` block, or use `--provider-model` when adding the provider to alias a generic id to the real model name.                                        |
| API returns `model_not_found` / `invalid model` | API provider rejected the model id                    | The id is wrong from the provider's perspective. Use the exact id from the provider's docs. Argue treats this as non-retryable.                                                                                         |
| Process killed during a long debate             | Default round timeout too short for your agents       | Default round timeout is 20 min (each task shares the same cap). Bump it only if your agents are unusually slow: `--per-round-timeout-ms 3600000` (also raises perTask, since perTask defaults to perRound when unset). |
| Agent eliminated mid-debate                     | Agent errored / timed out                             | Check `events.jsonl` for per-agent errors. Common causes: wrong model id, CLI not authenticated, rate limit hit.                                                                                                        |
| `Round failed minimum participant requirement`  | Too few agents completed a round                      | One or more agents errored out. Check `events.jsonl` for the failing agent. Verify each provider CLI works standalone first.                                                                                            |
| Config not found                                | Wrong config path                                     | Lookup order: `./argue.config.json` → `~/.config/argue/config.json`. Use `--config <path>` to pin a custom file.                                                                                                        |
| CLI not found                                   | Provider CLI not on PATH                              | Ensure `codex`, `gemini`, etc. are installed and accessible. Run `which <cli>` to verify.                                                                                                                               |
| `summary.md` missing                            | Debate killed before completion                       | `summary.md` only writes on successful completion. `events.jsonl` is written live and always available. Parse it directly for partial results.                                                                          |
| Rate limit errors                               | API throttling                                        | Reduce `--max-rounds` or wait it out. CLI-based providers usually handle rate limits internally.                                                                                                                        |

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
- Adding more agents barely affects wall-clock time — each round's participants are dispatched in parallel, so wall-clock is dominated by the slowest agent per round × number of rounds. Adding agents primarily costs **tokens**, not time: each extra agent produces its own claims and every other agent has to read them as peer context, so token usage grows roughly with N². Use 2–3 agents unless you have a specific reason to fan out wider.
- Very complex topics with long responses may need `--per-round-timeout-ms 2400000` (40 min) or higher — the 20 min default is enough for most debates but can clip agents doing deep analysis
- Network issues with API providers can cause intermittent agent failures — retry usually works
- Use `--token-budget` to cap per-agent token usage for faster debates on constrained topics
- Use `--global-deadline-ms` to enforce a hard deadline across the entire debate
