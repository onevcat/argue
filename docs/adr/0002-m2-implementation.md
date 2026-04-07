# ADR 0002 - M2 implementation contract (actual behavior)

This document records the **implemented** M2 behavior in `master` and serves as the integration contract for hosts.

## Context

M2 introduced early-stop, claim-level consensus, representative report mode, and stricter orchestration boundaries.
The plan (`docs/plan/v0-initial.md`) defines target behavior; this ADR captures what the engine currently enforces.

## Implemented decisions

### D1. Unified delegate task model (`kind=round|report`)

`AgentTaskDelegate` now uses a single task/result envelope:

- dispatch input: `AgentTaskInput` (`kind: "round" | "report"`)
- await output: `AgentTaskResult` (`kind: "round" | "report"`)

Reason: give host a single extension point with richer context and explicit task intent.

---

### D2. Representative report uses a separate report session

When `reportPolicy.composer="representative"`, engine dispatches a `kind="report"` task to:

- `sessionId = <prefix>:<argueSessionId>:report:<reporterId>`

Reason: avoid contaminating participant sticky round sessions and keep report generation isolated.

---

### D3. `representativeId` semantics

`reportPolicy.representativeId` has dual use:

1. If it matches an **active participant**, that participant is selected as representative (`reason="host-designated"`).
2. For report composition, it can also point to an **external reporter id** for host-side routing.

If designated id is not active, representative selection falls back to score/tie-break among active participants.

Reason: keep orchestration safe by default while allowing host-level external routing.

---

### D4. Report generation failure fallback

In representative mode, any report dispatch/await/shape failure falls back to builtin report composer.

Reason: fail-soft finalization; report path should not collapse a completed consensus run.

---

### D5. Claim consensus denominator = effective voters

For each active claim:

- denominator is `totalVoters` that actually voted on this claim
- resolved when `acceptCount / totalVoters >= consensusPolicy.threshold`
- if `totalVoters = 0`, claim is unresolved

Reason: tolerate elimination/timeout while preserving claim-level decision quality.

---

### D6. Elimination policy (all phases)

Timeout or task failure permanently eliminates participant for subsequent rounds, including `final_vote` phase.

- reasons: `timeout | error`
- persisted in `eliminations: EliminationRecord[]`

Reason: deterministic round membership and auditability.

---

### D7. Removed reserved fields (breaking)

The following fields are removed from accepted schema:

- `waitingPolicy.mode`
- `waitingPolicy.lateArrivalPolicy`
- `reportPolicy.maxReportChars`

`request.waitingPolicy` and `request.reportPolicy` are strict objects; unknown keys are rejected.

Reason: remove non-implemented knobs and keep contract explicit.

## Additional M2 runtime behavior

- Early-stop is enabled after `round >= minRounds` when all returned judgements are `agree` and no new claims were introduced.
- `globalDeadlineMs` blocks opening new debate rounds and forces unresolved terminal outcome.
- Correctness scoring core is peer-review agreement on claim ownership (post-merge canonical claim mapping).

## Current known gap vs plan

- JSONL run-log output is **not implemented** yet (session still provides structured rounds, eliminations, and metrics in `ArgueResult`).
