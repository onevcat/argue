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
