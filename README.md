# argue

A harness-agnostic orchestration engine for multi-agent consensus workflows.

Multiple AI agents analyze the same problem, debate claims across rounds, merge overlaps, vote per claim, and converge on structured consensus via one `start()` call.

## Why argue

| Problem | How argue solves it |
| --- | --- |
| Agents produce isolated partial answers | Parallel initial round + cross-round peer context |
| Debate quality is ad-hoc | Claim-level judgements (`agree` / `disagree` / `revise`) |
| Duplicate findings pollute results | Explicit claim merge with deterministic survivor rule |
| Binary final vote loses nuance | Per-claim consensus with configurable threshold |
| Hard to choose a final spokesperson | Peer-review weighted scoring + representative selection |
| Host code gets orchestration-heavy | Engine owns state machine, wait, elimination, and consensus |

## Core flow

1. **Initial round**: all participants produce claims.
2. **Debate rounds** (`1..N`): participants judge claims, can propose merges, and can revise statements.
3. **Early-stop**: after `minRounds`, stop early if all returned judgements agree and no new claims appear.
4. **Final vote**: participants vote `accept/reject` per active claim.
5. **Claim consensus**: each claim is resolved by `acceptCount / totalVoters >= threshold`.
6. **Representative**: selected from active participants by score (or host-designated active id).
7. **Report compose**:
   - `builtin`: engine-generated report
   - `representative`: engine dispatches a separate `kind="report"` task; failures fallback to builtin

## Delegate contract

Host implements a single delegate with task kind routing:

- `kind="round"`: initial/debate/final_vote task
- `kind="report"`: representative report composition task

Both use the same `dispatch` + `awaitResult` interface.

## Quick start

```ts
import { ArgueEngine, MemorySessionStore, DefaultWaitCoordinator } from "argue";

const taskDelegate = myTaskDelegate;

const engine = new ArgueEngine({
  taskDelegate,
  sessionStore: new MemorySessionStore(),
  waitCoordinator: new DefaultWaitCoordinator(taskDelegate)
});

const result = await engine.start({
  requestId: "review-42",
  topic: "Review PR #42",
  objective: "Find bugs, security issues, and design problems",
  participants: [
    { id: "agent-a", role: "security-reviewer" },
    { id: "agent-b", role: "architecture-reviewer" },
    { id: "agent-c", role: "correctness-reviewer" }
  ],
  roundPolicy: { minRounds: 2, maxRounds: 4 },
  consensusPolicy: { threshold: 0.67 },
  reportPolicy: { composer: "representative" }
});

// result.status: consensus | partial_consensus | unresolved | failed
// result.claimResolutions: per-claim vote outcome
// result.representative: selected spokesperson
// result.eliminations: timeout/error removals
// result.rounds: full round records
```

## M2 status

Implemented in current `master`:

- Early-stop (`minRounds` gated)
- Claim merge lifecycle (`active/merged/withdrawn`, `mergedInto`, proposer union)
- Claim-level final vote + `consensus / partial_consensus / unresolved`
- Effective-voter denominator per claim
- Permanent elimination on timeout/error (including final_vote)
- Representative report mode via separate report session
- Builtin fallback on representative report failure
- Strict schema cleanup (removed `waitingPolicy.mode`, `lateArrivalPolicy`, `reportPolicy.maxReportChars`)

Reference implementation ADR: [`docs/adr/0002-m2-implementation.md`](docs/adr/0002-m2-implementation.md)

## Current known gap

- JSONL run-log output is not implemented yet.

## License

MIT
