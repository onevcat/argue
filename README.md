# argue

**[中文](README_CN.md) | [日本語](README_JP.md)**

> _Follow the argument wherever it leads._ — Socrates, in Plato's _Republic_

argue is a structured multi-agent debate engine. Multiple AI agents analyze the same problem independently, challenge each other's claims across rounds, and converge on consensus through voting — producing higher quality results than any single agent alone.

Give it a question. Get back claims that survived cross-examination, votes that quantify agreement, and a representative report backed by peer-reviewed scoring. Less hallucination, more rigor.

## Live Demo

[![A sample argue report rendered in the hosted viewer](docs/assets/argue-report-sample.jpeg)](https://argue.onev.cat/example)

**[https://argue.onev.cat/example](https://argue.onev.cat/example)** — a real argue run rendered in the hosted viewer. Open it to see exactly what argue produces:

- **Agents arguing in the open.** Every claim, peer judgement, merge, and vote, round by round.
- **A polished dossier.** Composed by the highest-scoring agent — ready to read, share, or attach to a PR.
- **Complete raw data on disk.** The same JSON that powers the viewer is saved locally, ready to feed any downstream step (review bot, code generation, audit log, …).

## Install the Argue Skill

Already working with an agentic coding assistant (Claude Code, Codex, etc.)? Hand the setup over. Argue ships as an [agent skill](https://skills.sh/) that teaches your agent when to use argue, how to install and configure the CLI, which defaults to recommend, and how to run debates end-to-end.

```bash
npx skills add https://github.com/onevcat/argue --skill argue
```

Once installed, just ask your agent to "argue about X" or "get a second opinion on Y". It will bootstrap the CLI on first run (asking you before any global install) and drive the debate, the report, and any follow-up action for you.

## Quick Start

Prefer driving the CLI yourself like a cave-dweller with a stone axe? Suit yourself — here's the manual route.

### Install

```bash
npm install -g @onevcat/argue-cli
```

### Configure

```bash
# Create config file (~/.config/argue/config.json)
argue config init

# Add providers and agents
argue config add-provider --id claude --type cli --cli-type claude --model-id sonnet --agent claude-agent
argue config add-provider --id codex --type cli --cli-type codex --model-id gpt-5.3-codex --agent codex-agent
```

### Run a Debate

```bash
argue run --task "Should we use a monorepo or polyrepo for our microservices?"
```

Add `--verbose` to see each agent's reasoning, claims, and judgements in real time.

Need an agent to **act** on the result? Add `--action`:

```bash
argue run \
  --task "Review the issue: https://github.com/onevcat/argue/issues/22" \
  --action "Fix the issue based on consensus and open a PR" \
  --verbose
```

### What Happens

```
[argue] run started
  task: 研究这个 issue 的解法：https://github.com/onevcat/argue/issues/22
  agents: claude-agent, codex-agent | rounds: 2..3

[argue] initial#0  codex-agent (claims+6) — ESLint+Prettier setup, CI lint gate
[argue] initial#0  claude-agent (claims+6) — runtime bugs (couldn't access the issue URL)

[argue] debate#1   codex-agent (1✗ 5↻) — claude's claims valid but out-of-scope
[argue] debate#1   claude-agent (5✗ 1↻) — agreed, self-corrected
[argue] debate#1   claim merged c6 -> c2
  ... 2 more rounds, agents refine and converge ...

[argue] final_vote  11/11 claims accepted unanimously
[argue] result: consensus — codex-agent representative (83.70)
[argue] action: codex-agent opened PR #28
```

codex-agent accessed the issue and proposed ESLint/Prettier claims. claude-agent couldn't reach the URL and found runtime bugs instead. Through debate, codex-agent flagged them as out-of-scope, claude-agent self-corrected, and both converged. All 11 claims passed unanimously. The representative turned consensus into [a real PR](https://github.com/onevcat/argue/pull/28).

After each run, argue writes three output files to `~/.argue/output/<requestId>/` (global config) or `./out/<requestId>/` (local config):

| File           | Contents                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| `events.jsonl` | Streaming event log — every dispatch, response, merge, vote, and score          |
| `result.json`  | Structured result — status, claims, resolutions, scores, representative, action |
| `summary.md`   | Human-readable report from the representative agent                             |

[See the full unabridged output of this run.](https://gist.github.com/onevcat/bbf42778888180c443bea78f395f255b)

### View the Report

After every run, argue prints a hint telling you how to open the report in the hosted viewer:

```
→ View report: argue view argue_1712345678901_a3f9c2
```

You can also open the most recent run directly:

```bash
argue view                  # open the most recent run
argue view <request-id>     # open a specific run
argue run --view            # open automatically after a run completes
```

The report is gzip-compressed and base64url-encoded into the URL fragment, then decoded entirely in the browser — **nothing is uploaded to any server**. The default viewer is hosted at `https://argue.onev.cat/`. To point at a different viewer (for example, during local viewer development), set `viewer.url` in your config or pass `--viewer-url https://your-viewer/`.

### Common Options

For complex or repeated tasks, use an [input JSON file](https://github.com/onevcat/argue/blob/master/packages/argue-cli/examples/task.example.json) instead of inline flags:

```bash
argue run --input task.json
```

Useful flags:

```bash
--agents a1,a2          # pick specific agents from config
--min-rounds 2          # at least 2 debate rounds before early-stop
--max-rounds 5          # cap total debate rounds
--threshold 0.67        # consensus threshold (default: 1.0 = unanimous)
--action "Fix it"       # post-debate action for the representative
--verbose               # show each agent's reasoning in real time
```

Run `argue --help` for the full list.

## Using as a Library

Behind argue-cli is `@onevcat/argue`, a standalone debate engine you can embed in any system. Implement one interface — `AgentTaskDelegate` — and the engine handles all orchestration.

### Install

```bash
npm install @onevcat/argue
```

### Implement the Delegate

```ts
import type { AgentTaskDelegate } from "@onevcat/argue";

const delegate: AgentTaskDelegate = {
  async dispatch(task) {
    // Fire off the task and return a taskId immediately.
    // The engine dispatches all participants in parallel, then awaits
    // results separately — so this should return quickly without waiting for completion.
    const taskId = await myAgentFramework.submit(task);
    return { taskId, participantId: task.participantId, kind: task.kind };
  },

  async awaitResult(taskId, timeoutMs) {
    // Called per task to collect the result. The engine uses the taskId
    // to track timeouts, eliminations, and progressive settlement.
    const result = await myAgentFramework.waitFor(taskId, timeoutMs);
    return { ok: true, output: result };
  }
};
```

### Run the Engine

```ts
import { ArgueEngine, MemorySessionStore, DefaultWaitCoordinator } from "@onevcat/argue";

const engine = new ArgueEngine({
  taskDelegate: delegate,
  sessionStore: new MemorySessionStore(),
  waitCoordinator: new DefaultWaitCoordinator(delegate)
});

const result = await engine.start({
  requestId: "review-42",
  task: "Review PR #42 for security and correctness issues",
  participants: [
    { id: "security-agent", role: "security-reviewer" },
    { id: "arch-agent", role: "architecture-reviewer" },
    { id: "correctness-agent", role: "correctness-reviewer" }
  ],
  roundPolicy: { minRounds: 2, maxRounds: 4 },
  consensusPolicy: { threshold: 0.67 },
  reportPolicy: { composer: "representative" },
  actionPolicy: {
    prompt: "Fix all identified issues and post a summary comment."
  }
});

// result.status → "consensus" | "partial_consensus" | "unresolved"
// result.claimResolutions → per-claim vote outcomes
// result.representative → highest-scoring agent
// result.action → action output (if actionPolicy was set)
```

### Integration Example: Claude Code Hook

You can wire argue into existing tools via hooks. For example, as a [Claude Code hook](https://docs.anthropic.com/en/docs/claude-code/hooks) that triggers multi-agent review before every commit:

```jsonc
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node ./hooks/argue-review.mjs \"$TASK_INPUT\""
          }
        ]
      }
    ]
  }
}
```

```ts
// hooks/argue-review.mjs
import { ArgueEngine, MemorySessionStore, DefaultWaitCoordinator } from "@onevcat/argue";

// Your delegate implementation dispatches to your agent infrastructure
import { createDelegate } from "./my-delegate.mjs";

const input = JSON.parse(process.argv[2]);
if (!input.command?.includes("git commit")) process.exit(0);

const delegate = createDelegate();
const engine = new ArgueEngine({
  taskDelegate: delegate,
  sessionStore: new MemorySessionStore(),
  waitCoordinator: new DefaultWaitCoordinator(delegate)
});

const result = await engine.start({
  requestId: `pre-commit-${Date.now()}`,
  task: "Review staged changes for bugs, security issues, and style violations",
  participants: [
    { id: "security", role: "security-reviewer" },
    { id: "quality", role: "code-quality-reviewer" }
  ],
  roundPolicy: { minRounds: 1, maxRounds: 2 },
  consensusPolicy: { threshold: 1.0 }
});

if (result.status !== "consensus") {
  console.error("Review did not reach consensus. Blocking commit.");
  process.exit(1);
}
```

## How It Works

### Debate Flow

```
+------+                      +--------+                           +---------+         +---------+
| Host |                      | Engine |                           | Agent A |         | Agent B |
+------+                      +--------+                           +---------+         +---------+
    |                              |                                    |                   |
    |  start(task, participants)   |                                    |                   |
    |------------------------------>                                    |                   |
    |                              |                                    |                   |
    |                              |                 +-------------------+                  |
    |                              |                 | Round 0 - Initial |                  |
    |                              |                 +-------------------+                  |
    |                              |                                    |                   |
    |                              |         dispatch(initial)          |                   |
    |                              |------------------------------------>                   |
    |                              |                   dispatch(initial)|                   |
    |                              |-------------------------------------------------------->
    |                              |              claims                |                   |
    |                              <....................................|                   |
    |                              |                        claims      |                   |
    |                              <........................................................|
    |                              |                                    |                   |
    |                              |                +---------------------+                 |
    |                              |                | Round 1..N - Debate |                 |
    |                              |                +---------------------+                 |
    |                              |                                    |                   |
    |                              |  dispatch(debate + peer context)   |                   |
    |                              |------------------------------------>                   |
    |                              |            dispatch(debate + peer context)             |
    |                              |-------------------------------------------------------->
    |                              |        judgements, merges          |                   |
    |                              <....................................|                   |
    |                              |                  judgements, merges|                   |
    |                              <........................................................|
    |                              |                                    |                   |
    |                       +-------------+                             |                   |
    |                       | early-stop? |                             |                   |
    |                       +-------------+                             |                   |
    |                              |                                    |                   |
    |                              |              +------------------------+                |
    |                              |              | Round N+1 - Final Vote |                |
    |                              |              +------------------------+                |
    |                              |                                    |                   |
    |                              |       dispatch(final_vote)         |                   |
    |                              |------------------------------------>                   |
    |                              |                 dispatch(final_vote)                   |
    |                              |-------------------------------------------------------->
    |                              |      accept/reject per claim       |                   |
    |                              <....................................|                   |
    |                              |                accept/reject per claim                 |
    |                              <........................................................|
    |                              |                                    |                   |
    |                   +---------------------+                         |                   |
    |                   | consensus + scoring |                         |                   |
    |                   +---------------------+                         |                   |
    |                              |                                    |                   |
    |                              |         dispatch(report)           |                   |
    |                              |------------------------------------>                   |
    |                              |       representative report        |                   |
    |                              <....................................|                   |
    |                              |                                    |                   |
    |         ArgueResult          |                                    |                   |
    <..............................|                                    |                   |
    |                              |                                    |                   |
+------+                      +--------+                           +---------+         +---------+
| Host |                      | Engine |                           | Agent A |         | Agent B |
+------+                      +--------+                           +---------+         +---------+
```

### Phase Rules

| Phase                 | What agents do                                                    | What the engine does                                    |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
| **Initial** (round 0) | Propose claims, judge existing ones                               | Collect all claims into a shared pool                   |
| **Debate** (1..N)     | Judge peers' claims (`agree`/`disagree`/`revise`), propose merges | Merge duplicates, track stance shifts, check early-stop |
| **Final Vote** (N+1)  | Cast `accept`/`reject` per active claim                           | Compute per-claim consensus against threshold           |

### Key Mechanisms

- **Claim lifecycle**: Each claim is `active`, `merged`, or `withdrawn`. Merged claims transfer their proposers to the surviving claim.
- **Early stop**: If all judgements agree and no new claims emerge for `minRounds`, debate ends early — no wasted rounds.
- **Elimination**: Agents that timeout or error are permanently removed. Consensus denominators adjust automatically.
- **Scoring**: Agents are scored on correctness (35%), completeness (25%), actionability (25%), and consistency (15%) via peer review.
- **Representative**: The highest-scoring agent composes the final report. Falls back to a built-in summary on failure.
- **Action**: Optionally, the representative (or a designated agent) executes a real-world action based on the consensus.

### Provider Types

The CLI supports four provider types for connecting agents:

| Type   | Use case                             | Example                                              |
| ------ | ------------------------------------ | ---------------------------------------------------- |
| `cli`  | Coding agents with CLI interfaces    | Claude Code, Codex CLI, Copilot CLI, Gemini CLI      |
| `api`  | Direct model API access              | OpenAI, Anthropic, Ollama, any OpenAI-compatible API |
| `sdk`  | Custom adapters for agent frameworks | Your own SDK integration                             |
| `mock` | Testing and development              | Deterministic responses, simulated timeouts          |

## Config Reference

Full config example at [`packages/argue-cli/examples/config.example.json`](packages/argue-cli/examples/config.example.json).

Config lookup order:

1. `--config <path>` flag
2. `./argue.config.json` (local)
3. `~/.config/argue/config.json` (global)

CLI flags override input JSON, which overrides config defaults.

## Development

```bash
npm install
npm run dev              # watch mode
npm run ci               # typecheck + test + build
npm run release:check    # plus tarball smoke tests
```

## License

MIT
