# argue

A harness-agnostic orchestration engine for multi-agent consensus workflows.

Multiple AI agents analyze the same problem, debate each other's claims across rounds, merge overlapping findings, vote per-claim, and converge on a structured consensus — all driven by a single `start()` call.

## Why argue

| Problem | How argue solves it |
|---------|-------------------|
| Agents work in isolation, each producing a partial view | Parallel initial round → every agent sees the full picture |
| No structured way to challenge or refine claims | Claim-level judgement (agree / disagree / revise) across debate rounds |
| Duplicate findings scattered across agents | Explicit claim merge — agents declare overlaps, engine deduplicates |
| "Majority wins" ignores nuance | Per-claim consensus with configurable threshold; each claim resolves independently |
| Hard to tell which agent is most reliable | Peer-review scoring — correctness measured by how often others agree with your claims |
| Orchestration logic leaks into host code | argue owns the full state machine; host only implements a thin delegate (`dispatch` + `awaitResult`) |

## Key Concepts

```
┌─────────────────────────────────────────────────────────┐
│                    argue Engine                          │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐            │
│  │ Initial   │──▶│ Debate   │──▶│ Final    │            │
│  │ Round     │   │ Rounds   │   │ Vote     │            │
│  │ (round 0) │   │ (1..N)   │   │ (N+1)    │            │
│  └──────────┘   └──────────┘   └──────────┘            │
│       │              │  ▲            │                   │
│       │              │  │            │                   │
│       │         early-stop?     per-claim                │
│       │         claim merge     consensus                │
│       │         elimination     threshold                │
│       ▼              ▼               ▼                   │
│  ┌─────────────────────────────────────────────┐        │
│  │            Scoring + Representative          │        │
│  │         (peer-review → top scorer)           │        │
│  └─────────────────────────────────────────────┘        │
│       │                                                  │
│       ▼                                                  │
│  ┌──────────────────────┐                               │
│  │   Report Compose     │                               │
│  │ (builtin / agent)    │                               │
│  └──────────────────────┘                               │
└─────────────────────────────────────────────────────────┘
         ▲                            │
         │ AgentTaskDelegate          │ ArgueResult
    host dispatches              consensus status
    agent calls                  + claim resolutions
                                 + full run records
```

### Flow

1. **Initial round** — all participants receive the topic in parallel and produce their initial claims.
2. **Debate rounds** — each participant sees others' full responses, judges each claim (`agree` / `disagree` / `revise`), and can declare claim merges. Engine processes merges and eliminates timed-out participants each round.
3. **Early-stop** — after `minRounds`, if all active participants agree on everything and no new claims emerge, remaining debate rounds are skipped.
4. **Final vote** — each participant votes `accept` / `reject` on every active claim independently.
5. **Consensus** — each claim is resolved when `accept` ratio ≥ `consensusThreshold`. Session outcome: `consensus` (all resolved) / `partial_consensus` / `unresolved`.
6. **Scoring** — four-dimension rubric where **correctness = peer review** (how often others agree with your claims). Top scorer becomes the representative.
7. **Report** — `builtin` template, or the representative agent generates the report via an argue-composed prompt.

### Claims & Merging

Claims are first-class objects tracked across rounds. Each claim knows who proposed it (`proposedBy`), its lifecycle status (`active` / `merged` / `withdrawn`), and — if merged — which claim it was folded into.

During debate, any participant can declare `mergesWith` on a claim they believe duplicates another. The engine resolves merges deterministically: **the earliest claim survives**, with chain merges resolved recursively. All original proposers share credit.

### Scoring & Representative

Participants are scored on four dimensions (host-configurable weights):

- **Correctness** — peer review: what proportion of your claims were agreed upon by others
- **Completeness** — breadth of claim coverage and response depth
- **Actionability** — concrete suggestions and revised statements
- **Consistency** — stance coherence across rounds

The highest scorer is selected as the session's **representative**, producing the final speech and (optionally) composing the report.

## What argue Does — and What It Doesn't

argue **only does orchestration**:

- State machine & round sequencing
- Claim tracking, merging, and per-claim consensus
- Wait coordination with timeout + permanent elimination
- Peer-review scoring & representative selection
- Prompt composition (built-in templates, host-overridable)
- Structured event emission & JSONL run log

argue **does not**:

- Fetch input from external sources (GitHub, Discord, Slack, etc.)
- Bind to any specific agent runtime or LLM provider
- Write results back to external platforms

The host injects these via a single delegate interface: `AgentTaskDelegate` (`dispatch` + `awaitResult`).

## Quick Start

```ts
import { ArgueEngine, MemorySessionStore, DefaultWaitCoordinator } from "argue";

const engine = new ArgueEngine({
  delegate: myAgentDelegate,    // you implement: dispatch + awaitResult
  store: new MemorySessionStore(),
  waitCoordinator: new DefaultWaitCoordinator(myAgentDelegate),
});

const result = await engine.start({
  requestId: "review-42",
  topic: "Review PR #42",
  objective: "Find bugs, security issues, and design problems",
  participants: [
    { id: "agent-a", role: "security-reviewer" },
    { id: "agent-b", role: "architecture-reviewer" },
    { id: "agent-c", role: "correctness-reviewer" },
  ],
  roundPolicy: { minRounds: 2, maxRounds: 4 },
  consensusPolicy: { threshold: 0.67 },
});

// result.status — "consensus" | "partial_consensus" | "unresolved" | "failed"
// result.claimResolutions — per-claim accept/reject breakdown
// result.representative — top-scored agent's final speech
// result.rounds — full run records for audit
```

## Status

- **M1 (core engine)** — shipped. State machine, sticky sessions, claim-level judgement, event-first wait, builtin reports, heuristic scoring.
- **M2 (integration-ready)** — in progress. Early-stop, claim merging, per-claim consensus, peer-review scoring, representative report mode, prompt templates, JSONL run log.

Design doc: [`docs/plan/v0-initial.md`](docs/plan/v0-initial.md)

## License

MIT
