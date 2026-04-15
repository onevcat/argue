---
name: argue
description: "Run structured multi-agent debates using argue CLI for cross-examined, high-confidence answers. Use when facing strategic decisions, ambiguous trade-offs, architecture debates, or questions where multiple perspectives improve the answer. Triggers on: argue, debate, cross-examine, second opinion, multi-agent, 'Should we X or Y?' with real stakes, consensus-building, risk analysis, or confirmation-bias mitigation."
license: MIT
compatibility: "Requires argue CLI (@onevcat/argue-cli v0.2+) and at least 2 configured agents. CLI-based providers need their respective CLIs installed (codex, gemini, claude, etc.). API-based providers need API keys in environment."
metadata: { "author": "onevcat", "repo": "https://github.com/onevcat/argue" }
---

# Argue — Multi-Agent Debate Engine

Structured debates where AI agents analyze independently, cross-examine across rounds, and converge on consensus through voting. Higher-confidence answers than any single model alone.

## When to Use

✅ Strategic / architectural decisions with real trade-offs, "Should we X or Y?" with real stakes, risk analysis, confirmation-bias mitigation, pre-commit quality gates on big decisions.

❌ Simple factual lookups, time-critical tasks (debates take 3–7 minutes), open-ended creative generation, questions with obvious answers.

## Pre-flight

If `argue` is not on PATH, install it (confirm with the user first — this is a global install):

```bash
npm install -g @onevcat/argue-cli
```

Then verify and configure:

```bash
argue version                          # verify installed (v0.2+)
argue config init --global             # ~/.config/argue/config.json — recommended for agent use

# Add at least 2 agents — `--agent <id>` shorthand creates provider + agent in one shot
argue config add-provider --id codex  --type cli --cli-type codex  --model-id gpt-5.4 --agent codex-agent
argue config add-provider --id gemini --type cli --cli-type gemini --model-id gemini-3.1-pro-preview --agent gemini-agent
```

**Why global by default**: a global config is set up once and works from any cwd, and outputs go to `~/.argue/output/<requestId>/` instead of cluttering the current project tree. Use `argue config init --local` only when a specific project needs its own dedicated agent line-up — that writes `./argue.config.json` and outputs to `./out/<requestId>/`.

For API providers, SDK adapters, roles, and system prompts, see [references/setup.md](references/setup.md).

## Running Debates

```bash
# Basic — 2 agents, 2-3 rounds, auto-consensus
argue run --task "Should we use a monorepo or polyrepo?" --verbose

# With a follow-up action: representative executes once consensus is reached
argue run \
  --task "Review the API design in docs/api.md" \
  --action "Implement the consensus recommendation and open a PR" \
  --verbose

# Open the rendered report in the hosted viewer when the run finishes
argue run --task "..." --view
```

Useful flags (full list: `argue --help`):

| Flag                                             | Purpose                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `--agents a,b`                                   | Pick which agents participate (default: `defaults.defaultAgents` from config, else **all configured agents**) |
| `--min-participants <n>`                         | Minimum surviving participants required to continue (default: 2)                                              |
| `--on-insufficient-participants interrupt\|fail` | When too few participants remain, either emit `interrupted` (default) or fail hard                            |
| `--min-rounds` / `--max-rounds`                  | Control debate depth (defaults: 2 / 3)                                                                        |
| `--threshold <0..1>`                             | Consensus threshold (default: 1 = unanimous)                                                                  |
| `--action <prompt>`                              | Execute task after consensus                                                                                  |
| `--view` / `--viewer-url <url>`                  | Open report in the hosted viewer                                                                              |
| `--input <file>`                                 | JSON input for complex setups                                                                                 |
| `--verbose` / `-v`                               | Stream agent reasoning live                                                                                   |

Debates typically take 3–7 minutes for 2 agents × 3 rounds. Default cap is 20 min per round (and per task, which tracks the round cap by default); bump `--per-round-timeout-ms` for heavy reviews.

## Viewing & Acting on Results

When a run finishes, argue prints the request id and a viewer hint. Open it any time:

```bash
argue view                  # most recent run
argue view <request-id>     # specific run
```

The hosted viewer renders `result.json` entirely client-side (gzip + base64url in the URL fragment — nothing is uploaded). Use `--viewer-url` to point at a self-hosted viewer.

To run a follow-up task using a debate result as context:

```bash
argue act --result ~/.argue/output/<requestId>/result.json --task "Write a summary blog post"
argue act --result ./out/<requestId>/result.json --task "Implement the changes" --agent codex-agent
```

## Output Files

After every run, argue writes to `~/.argue/output/<requestId>/` (global config) or `./out/<requestId>/` (project-local config):

- `result.json` — full structured result
- `summary.md` — markdown report (written on completion)
- `events.jsonl` — event stream (written live, survives crashes — parse it for partial results if a run is killed)
- `error.json` — error details (only on failure)

Result status: `consensus` | `partial_consensus` | `unresolved` | `interrupted` | `failed`.

If a debate drops below the required participant count, prefer the default `interrupted` path so downstream tools still get a structured result. Only force `onInsufficientParticipants: "fail"` when the caller explicitly needs legacy hard-failure semantics.

If you need to parse `result.json` programmatically, the canonical schema lives at [`packages/argue/src/contracts/result.ts`](https://github.com/onevcat/argue/blob/master/packages/argue/src/contracts/result.ts).

## Tips

1. **Frame as decisions, not topics.** "Should we use SwiftUI or UIKit?" beats "Tell me about SwiftUI".
2. **Add context.** "Should we use a monorepo? Context: 8 microservices, 3 teams, Node+Go" produces sharper claims.
3. **2–3 agents is the sweet spot.** Agents in the same round are dispatched in parallel, so wall-clock is dominated by rounds rather than agent count — adding more agents barely costs time. The real cost is **tokens**: every extra agent produces its own claims, plus every other agent has to read them as peer context, so token usage grows roughly with N². If the user's config has more than 3 agents, pass `--agents a,b,c` explicitly to pick a focused subset, or set `defaults.defaultAgents` in the config file once.
4. **Use `--action`** when consensus should drive code changes or another real-world side-effect.

## Troubleshooting

For common errors and fixes, see [references/troubleshooting.md](references/troubleshooting.md).
