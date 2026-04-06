# ADR 0001 - M1 implementation decisions tracker

This file captures implementation-time decisions that were not explicit in the plan and are included in the M1 PR.

## D1. Round index convention

- `initial` round uses `round=0`
- `debate` rounds use `round=1..maxRounds`
- `final_vote` uses `round=maxRounds+1`

Reason: keeps phase boundaries explicit while preserving a numeric round timeline.

## D2. Consensus voting rule with partial completion

Status is `consensus` when:

1. `accept` votes count `>= minParticipants`
2. no `reject` votes in received final votes

Timed-out participants do not block consensus as long as the minimum accepted participant threshold is met.

Reason: aligns with `minParticipants=2` and timeout-tolerant M1 execution.

## D3. Claim fallback seeding

If initial round returns no `extractedClaims`, engine creates seed claims from participant summaries.

Reason: prevent empty claim graph from stalling debate/finalization.

## D4. Report composer fallback

If `reportPolicy.composer="delegate-agent"` but no `ReportComposerDelegate` is provided, engine falls back to builtin report composer.

Reason: fail-soft behavior for host integration mistakes in M1.

## D5. Failure path contract

If orchestration throws after session creation, the engine now:

1. transitions session state to `failed`
2. persists structured `{ code, message }` error info to the session store
3. emits a `Failed` observer event
4. rethrows the original error to the caller

Reason: preserve a stable terminal state for host integrations without hiding operational failures from the caller.

## D6. Scoring rubric semantics

`scoringPolicy.rubric` now participates in score calculation as actual dimension weights over four heuristic dimensions:

- correctness
- completeness
- actionability
- consistency

The exported `ParticipantScore.breakdown` contains averaged per-dimension scores, not a copy of the configured rubric weights.

Reason: avoid exposing a no-op public switch while keeping M1 scoring lightweight and host-agnostic.

## D7. Explicit M1 boundary for reserved policy fields

The following schema fields remain reserved in M1 and are accepted but not yet enforced by the default runtime path:

- `waitingPolicy.mode`
- `waitingPolicy.globalDeadlineMs`
- `waitingPolicy.lateArrivalPolicy`
- `roundPolicy.minRounds`
- `reportPolicy.maxReportChars`

Reason: keep the contract shape aligned with the plan while making the current implementation boundary explicit.
