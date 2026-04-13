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

✅ **Use argue when:**
- Strategic or architectural decisions with real trade-offs
- Questions where reasonable experts genuinely disagree
- Pre-commit quality gates on major decisions
- Risk analysis or confirmation-bias mitigation
- "Should we X or Y?" with real stakes

❌ **Don't use argue when:**
- Simple factual lookups (just search)
- Time-critical tasks (debates take 3-7 minutes)
- Creative/open-ended generation (not a debate format)
- Questions with obvious answers

## Pre-flight

Before first use, ensure argue is configured:

```bash
argue --version  # verify installed (v0.2+)
argue config init --local  # project-local, or --global for ~/.config/argue/

# Add CLI-based providers (recommended — uses existing CLI auth)
argue config add-provider --id codex --type cli --cli-type codex --model-id gpt-5.4
argue config add-provider --id gemini --type cli --cli-type gemini --model-id gemini-3.1-pro-preview

# Add at least 2 agents
argue config add-agent --id codex-agent --provider codex --model gpt-5.4
argue config add-agent --id gemini-agent --provider gemini --model gemini-3.1-pro-preview
```

For advanced setup (API providers, SDK adapters, roles, system prompts), see [references/setup.md](references/setup.md).

## Running Debates

```bash
# Basic — 2 agents, 2-3 rounds, auto-consensus
argue run --task "Should we use a monorepo or polyrepo?" --verbose

# With post-debate action — execute after consensus
argue run \
  --task "Review the API design in docs/api.md" \
  --action "Implement the consensus recommendation and open a PR" \
  --verbose

# Specific agents + deeper rounds
argue run --task "..." --agents codex-agent,gemini-agent --min-rounds 3 --max-rounds 5

# JSON input for complex tasks
argue run --input debate-config.json --verbose
```

**Always use `--verbose`** to see agent reasoning and claim evolution in real-time. Set exec timeout to **600 seconds** — 2 agents × 3 rounds typically take 3-7 minutes.

## Key Options

| Flag | Purpose | Default |
|------|---------|---------|
| `--agents <ids>` | Override which agents participate | all configured |
| `--min-rounds` / `--max-rounds` | Control debate depth | 2-3 |
| `--threshold <0-1>` | Consensus threshold | auto |
| `--composer builtin\|representative` | Report style | builtin |
| `--representative-id <id>` | Agent for representative composer | — |
| `--action <prompt>` | Execute task after consensus | none |
| `--action-agent <id>` | Override which agent executes action | representative |
| `--language <lang>` | Output language | config default |
| `--token-budget <n>` | Token limit per agent | unlimited |
| `--trace` / `--trace-level` | Debug tracing | off |
| `--input <file>` | JSON config for complex setups | — |
| `--jsonl` / `--result` / `--summary` | Output file paths | auto |

## Understanding Output

**Debate flow:**
1. **Round 0 (initial):** Each agent responds independently with claims
2. **Rounds 1-N (debate):** Agents cross-examine, challenge, merge, and refine claims
3. **Final vote:** Agents vote on remaining claims (✓ accept, ✗ reject, ↻ revise)
4. **Report:** Final consensus report

**Key metrics:**
- **Claims:** Unique propositions (grows in round 0, shrinks via merges in later rounds)
- **Consensus score:** 0-100 (higher = stronger agreement)
- **Result type:** `consensus` (agreement) or `partial` (disagreement remains)

**Output files** (at `~/.argue/output/argue_<requestId>/`):
- `result.json` — full structured result
- `summary.md` — markdown summary (written on completion)
- `events.jsonl` — event stream (written live)

## Tips for Better Debates

1. **Frame as decisions, not topics.** "Should we use SwiftUI or UIKit?" > "Tell me about SwiftUI"
2. **Add context.** "Should we use a monorepo? Context: 8 microservices, 3 teams, Node+Go"
3. **Use `--action` for implementation.** When consensus should drive code changes
4. **Two agents is the sweet spot.** More agents = longer debates with diminishing returns
5. **Representative composer** gives a single coherent report; **builtin** gives synthesized summary
6. **If debate is killed mid-round**, `events.jsonl` still has all data — parse it directly

## Troubleshooting

For common errors and fixes, see [references/troubleshooting.md](references/troubleshooting.md).