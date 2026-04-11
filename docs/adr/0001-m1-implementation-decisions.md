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

## D8. Reserved fields handoff table

This table exists so the next agent can continue from the current M1 boundary without guessing which fields are already live, which are only accepted by schema, and what semantic decisions still need to be nailed down before implementation.

| Field                             | Current M1 status                                                                                                                                                  | Next semantic decision to make                                                                                                                                                                                                  | Suggested completion/test anchor                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `roundPolicy.minRounds`           | Parsed and validated by schema (`maxRounds >= minRounds`), but not consulted by runtime control flow. The engine still runs `initial + 1..maxRounds + final_vote`. | Decide whether `minRounds` means "do not allow early finalize before N debate rounds" or some other gating rule. Also decide whether future early-stop logic can still emit `consensus` before `maxRounds`.                     | Add engine tests that demonstrate a path where `minRounds < maxRounds` and early-stop is either forbidden or allowed according to the chosen rule.  |
| `waitingPolicy.mode`              | Schema accepts `event-first                                                                                                                                        | polling                                                                                                                                                                                                                         | hybrid`, but `DefaultWaitCoordinator` currently behaves as event-first only.                                                                        | Define whether `polling` and `hybrid` are implemented inside `WaitCoordinator` itself or delegated to host/runtime adapters. | Add coordinator-level tests showing distinct behavior for `event-first`, `polling`, and `hybrid`. |
| `waitingPolicy.globalDeadlineMs`  | Accepted by schema, ignored by runtime. No session-level deadline is tracked after `start()`.                                                                      | Decide whether the deadline applies to the whole orchestration session, only to waiting windows, or both. Also decide whether deadline expiry produces `failed` or `unresolved`.                                                | Add a test where cumulative round progress crosses the global deadline and assert terminal state, stored error/result, and observer event sequence. |
| `waitingPolicy.lateArrivalPolicy` | Accepted by schema. Current implementation cancels timed-out tasks and never merges late results back in.                                                          | Define what counts as "before finalize" and whether late results can mutate an already completed round, only the current round, or only metrics/trace.                                                                          | Add tests for both `accept-if-before-finalize` and `drop`, including a delayed participant result arriving after round timeout.                     |
| `reportPolicy.maxReportChars`     | Accepted by schema, ignored by builtin and delegate-agent report composition paths.                                                                                | Decide whether the limit applies to the whole serialized report, `finalSummary`, `representativeSpeech`, or only builtin composition. Also decide whether delegate composers must hard-enforce it or just receive it as a hint. | Add report composition tests that assert truncation or bounded output length for builtin mode, and contract tests for delegate-agent mode.          |

Practical handoff rule: until a field has both (1) explicit semantics captured here or in a follow-up ADR and (2) a matching automated test, treat it as **accepted by contract but not part of the guaranteed M1 runtime behavior**.
