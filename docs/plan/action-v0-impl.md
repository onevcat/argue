# Action System v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a post-debate action step where a single agent consumes the ArgueResult and performs real-world operations, plus enrich summary.md to be a comprehensive human-readable report.

**Architecture:** Action is a new task kind (`kind="action"`) in the core engine, dispatched after report composition. It reuses the existing `AgentTaskDelegate` interface. The CLI gains `--action`/`--action-agent` flags on `argue run`, an `action` field in run input files, and a standalone `argue act` sub-command.

**Tech Stack:** TypeScript, Zod schemas, vitest

---

## File Structure

### Core library (`packages/argue/src/`)

| File | Action |
|---|---|
| `contracts/result.ts` | Modify — add `ActionOutputSchema` and `action?` field to `ArgueResultSchema` |
| `contracts/request.ts` | Modify — add `actionPolicy` to `ArgueStartInputSchema` |
| `contracts/task.ts` | Modify — add `ActionTaskInputSchema`, `ActionTaskResultSchema`, extend discriminated unions |
| `contracts/events.ts` | Modify — add `ActionDispatched`, `ActionCompleted`, `ActionFailed` event types |
| `core/engine.ts` | Modify — add `executeAction()` method, call it after `composeReport()` |
| `index.ts` | Modify — export new types and schemas |

### Core library tests (`packages/argue/test/`)

| File | Action |
|---|---|
| `engine.test.ts` | Modify — add action flow tests |

### CLI (`packages/argue-cli/src/`)

| File | Action |
|---|---|
| `artifacts.ts` | Modify — enrich `buildResultSummary()` |
| `run-input.ts` | Modify — add `action` field to `RunInputSchema` |
| `run-plan.ts` | Modify — add `actionPolicy` to `ResolvedRunPlan.startInput` |
| `index.ts` | Modify — add `--action`, `--action-agent` flags, `argue act` sub-command |
| `output.ts` | Modify — add event handlers for action events |
| `runtime/task-output.ts` | Modify — handle `kind="action"` in normalization |
| `runtime/prompt.ts` | Modify — handle action task prompt building |

### CLI tests (`packages/argue-cli/test/`)

| File | Action |
|---|---|
| `artifacts.test.ts` | Create — test enriched summary output |
| `output.test.ts` | Modify — add action event output tests |

---

## Task 1: Enrich summary.md output

**Files:**
- Modify: `packages/argue-cli/src/artifacts.ts:16-37`
- Create: `packages/argue-cli/test/artifacts.test.ts`

- [ ] **Step 1: Write the failing test for enriched summary**

```typescript
// packages/argue-cli/test/artifacts.test.ts
import { describe, expect, it } from "vitest";
import { buildResultSummary } from "../src/artifacts.js";
import type { ArgueResult } from "argue";

function makeResult(overrides: Partial<ArgueResult> = {}): ArgueResult {
  return {
    requestId: "req-1",
    sessionId: "sess-1",
    status: "consensus",
    finalClaims: [
      { claimId: "c1", title: "Main claim", statement: "The primary conclusion.", category: "pro", proposedBy: ["a1", "a2"], status: "active" },
      { claimId: "c2", title: "Risk item", statement: "A potential risk.", category: "risk", proposedBy: ["a1"], status: "active" }
    ],
    claimResolutions: [
      { claimId: "c1", status: "resolved", acceptCount: 2, rejectCount: 0, totalVoters: 2, votes: [] },
      { claimId: "c2", status: "resolved", acceptCount: 1, rejectCount: 1, totalVoters: 2, votes: [] }
    ],
    representative: { participantId: "a1", reason: "top-score", score: 85.5, speech: "We reached consensus." },
    scoreboard: [
      { participantId: "a1", total: 85.5, byRound: [], breakdown: { correctness: 90, completeness: 80, actionability: 85, consistency: 87 } },
      { participantId: "a2", total: 72.3, byRound: [], breakdown: { correctness: 70, completeness: 75, actionability: 72, consistency: 72 } }
    ],
    eliminations: [],
    report: { mode: "representative", traceIncluded: false, traceLevel: "compact", finalSummary: "Consensus reached on 2 claims.", representativeSpeech: "We reached consensus." },
    disagreements: [{ claimId: "c2", participantId: "a2", reason: "Insufficient evidence." }],
    rounds: [
      {
        round: 0,
        outputs: [
          { participantId: "a1", phase: "initial", round: 0, fullResponse: "f", summary: "Agent A initial view.", judgements: [] },
          { participantId: "a2", phase: "initial", round: 0, fullResponse: "f", summary: "Agent B initial view.", judgements: [] }
        ]
      },
      {
        round: 1,
        outputs: [
          {
            participantId: "a1", phase: "debate", round: 1, fullResponse: "f", summary: "Agent A agrees.",
            judgements: [
              { claimId: "c1", stance: "agree", confidence: 0.95, rationale: "Strong." },
              { claimId: "c2", stance: "agree", confidence: 0.6, rationale: "Weak but accept." }
            ]
          },
          {
            participantId: "a2", phase: "debate", round: 1, fullResponse: "f", summary: "Agent B disagrees on c2.",
            judgements: [
              { claimId: "c1", stance: "agree", confidence: 0.9, rationale: "Confirmed." },
              { claimId: "c2", stance: "disagree", confidence: 0.8, rationale: "Not enough data." }
            ]
          }
        ]
      }
    ],
    metrics: { elapsedMs: 15000, totalRounds: 2, totalTurns: 4, retries: 0, waitTimeouts: 0, earlyStopTriggered: false, globalDeadlineHit: false },
    ...overrides
  } as ArgueResult;
}

describe("buildResultSummary", () => {
  it("includes all sections in enriched summary", () => {
    const summary = buildResultSummary(makeResult());

    // Metadata
    expect(summary).toContain("status: consensus");
    expect(summary).toContain("representative: a1");
    expect(summary).toContain("15.0s");

    // Conclusion
    expect(summary).toContain("## Conclusion");
    expect(summary).toContain("Consensus reached on 2 claims.");

    // Representative statement
    expect(summary).toContain("## Representative statement");
    expect(summary).toContain("We reached consensus.");

    // Claims
    expect(summary).toContain("## Claims");
    expect(summary).toContain("c1: Main claim");
    expect(summary).toContain("[pro]");
    expect(summary).toContain("2/2 accept");
    expect(summary).toContain("c2: Risk item");
    expect(summary).toContain("[risk]");

    // Per-agent stance on claims
    expect(summary).toContain("a1: agree (95%)");
    expect(summary).toContain("a2: disagree (80%)");

    // Scoreboard
    expect(summary).toContain("## Scoreboard");
    expect(summary).toContain("a1: 85.50");
    expect(summary).toContain("correctness=90");
    expect(summary).toContain("a2: 72.30");

    // Disagreements
    expect(summary).toContain("## Disagreements");
    expect(summary).toContain("c2");
    expect(summary).toContain("Insufficient evidence.");

    // Metrics
    expect(summary).toContain("## Metrics");
    expect(summary).toContain("rounds: 2");
    expect(summary).toContain("turns: 4");
  });

  it("omits empty sections", () => {
    const summary = buildResultSummary(makeResult({ disagreements: [], eliminations: [] }));
    expect(summary).not.toContain("## Disagreements");
    expect(summary).not.toContain("## Eliminations");
  });

  it("includes eliminations when present", () => {
    const summary = buildResultSummary(makeResult({
      eliminations: [{ participantId: "a3", round: 1, reason: "timeout", at: "2026-04-10T00:00:00Z" }]
    }));
    expect(summary).toContain("## Eliminations");
    expect(summary).toContain("a3: timeout at round 1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/artifacts.test.ts` from `packages/argue-cli`
Expected: FAIL — current `buildResultSummary` does not produce enriched output.

- [ ] **Step 3: Implement enriched buildResultSummary**

Replace `buildResultSummary` in `packages/argue-cli/src/artifacts.ts:16-37` with:

```typescript
export function buildResultSummary(result: ArgueResult): string {
  const lines: string[] = [];

  // Title
  lines.push(`# argue run ${result.requestId}`, "");

  // Metadata
  lines.push("## Metadata", "");
  lines.push(`- status: ${result.status}`);
  lines.push(`- representative: ${result.representative.participantId} (${result.representative.reason}, score=${formatNumber(result.representative.score)})`);
  lines.push(`- elapsed: ${formatMs(result.metrics.elapsedMs)}`);
  lines.push(`- rounds: ${result.metrics.totalRounds}, turns: ${result.metrics.totalTurns}`);
  const activeClaims = result.finalClaims.filter((c) => c.status === "active");
  lines.push(`- claims: ${activeClaims.length} active / ${result.finalClaims.length} total`);
  const resolved = result.claimResolutions.filter((r) => r.status === "resolved");
  lines.push(`- resolved: ${resolved.length}/${result.claimResolutions.length}`);

  // Conclusion
  if (result.report.finalSummary) {
    lines.push("", "## Conclusion", "", result.report.finalSummary);
  }

  // Representative statement
  if (result.report.representativeSpeech) {
    lines.push("", "## Representative statement", "", result.report.representativeSpeech);
  }

  // Claims with per-agent stance
  if (activeClaims.length > 0) {
    const lastRound = result.rounds.length > 0
      ? result.rounds.reduce((a, b) => a.round > b.round ? a : b)
      : undefined;

    lines.push("", "## Claims", "");
    for (const claim of activeClaims) {
      const catTag = claim.category ? ` [${claim.category}]` : "";
      const resolution = result.claimResolutions.find((r) => r.claimId === claim.claimId);
      const voteStr = resolution ? ` — ${resolution.acceptCount}/${resolution.totalVoters} accept` : "";
      lines.push(`### ${claim.claimId}: ${claim.title}${catTag}${voteStr}`, "");
      lines.push(claim.statement, "");

      // Per-agent stance from last round
      if (lastRound) {
        for (const output of lastRound.outputs) {
          const j = output.judgements.find((jj) => jj.claimId === claim.claimId);
          if (j) {
            lines.push(`- ${output.participantId}: ${j.stance} (${(j.confidence * 100).toFixed(0)}%) — ${j.rationale}`);
          }
        }
        lines.push("");
      }
    }
  }

  // Scoreboard
  if (result.scoreboard.length > 0) {
    lines.push("## Scoreboard", "");
    const sorted = [...result.scoreboard].sort((a, b) => b.total - a.total);
    for (const entry of sorted) {
      const parts: string[] = [];
      if (entry.breakdown?.correctness !== undefined) parts.push(`correctness=${formatNumber(entry.breakdown.correctness)}`);
      if (entry.breakdown?.completeness !== undefined) parts.push(`completeness=${formatNumber(entry.breakdown.completeness)}`);
      if (entry.breakdown?.actionability !== undefined) parts.push(`actionability=${formatNumber(entry.breakdown.actionability)}`);
      if (entry.breakdown?.consistency !== undefined) parts.push(`consistency=${formatNumber(entry.breakdown.consistency)}`);
      const breakdownStr = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      lines.push(`- ${entry.participantId}: ${formatNumber(entry.total)}${breakdownStr}`);
    }
    lines.push("");
  }

  // Disagreements
  if (result.disagreements && result.disagreements.length > 0) {
    lines.push("## Disagreements", "");
    for (const d of result.disagreements) {
      lines.push(`- ${d.claimId} by ${d.participantId}: ${d.reason}`);
    }
    lines.push("");
  }

  // Eliminations
  if (result.eliminations.length > 0) {
    lines.push("## Eliminations", "");
    for (const e of result.eliminations) {
      lines.push(`- ${e.participantId}: ${e.reason} at round ${e.round}`);
    }
    lines.push("");
  }

  // Metrics
  lines.push("## Metrics", "");
  const m = result.metrics;
  lines.push(`- elapsed: ${formatMs(m.elapsedMs)}`);
  lines.push(`- rounds: ${m.totalRounds}`);
  lines.push(`- turns: ${m.totalTurns}`);
  lines.push(`- retries: ${m.retries}`);
  lines.push(`- timeouts: ${m.waitTimeouts}`);
  if (m.earlyStopTriggered) lines.push("- early stop: yes");
  if (m.globalDeadlineHit) lines.push("- global deadline hit: yes");

  return lines.join("\n");
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m${seconds}s`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/artifacts.test.ts` from `packages/argue-cli`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test` from repo root
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/argue-cli/src/artifacts.ts packages/argue-cli/test/artifacts.test.ts
git commit -m "feat(argue-cli): enrich summary.md with claims, stances, scoreboard, and metrics"
```

---

## Task 2: Add action schemas to core library contracts

**Files:**
- Modify: `packages/argue/src/contracts/result.ts:149-186`
- Modify: `packages/argue/src/contracts/request.ts:69-78`
- Modify: `packages/argue/src/contracts/task.ts:239-265`
- Modify: `packages/argue/src/contracts/events.ts:3-17`
- Modify: `packages/argue/src/index.ts`

- [ ] **Step 1: Add ActionOutputSchema to result.ts**

Add before `ArgueResultSchema` (before line 149 in `result.ts`):

```typescript
export const ActionOutputSchema = z.object({
  actorId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  fullResponse: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  error: z.string().min(1).optional()
});

export type ActionOutput = z.infer<typeof ActionOutputSchema>;
```

Then add `action` field to `ArgueResultSchema`:

```typescript
// Inside ArgueResultSchema, after the `error` field:
action: ActionOutputSchema.optional()
```

- [ ] **Step 2: Add actionPolicy to request.ts**

Add after `reportPolicy` (after line 78 in `request.ts`):

```typescript
actionPolicy: z.object({
  prompt: z.string().min(1),
  actorId: z.string().min(1).optional(),
  includeFullResult: z.boolean().default(true)
}).strict().optional(),
```

- [ ] **Step 3: Add ActionTaskInput and ActionTaskResult to task.ts**

Add after `ReportTaskResultSchema` (after line 258 in `task.ts`):

```typescript
export const ActionTaskInputSchema = z.object({
  kind: z.literal("action"),
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  participantId: z.string().min(1),
  prompt: z.string().min(1),
  argueResult: z.object({
    status: z.enum(["consensus", "partial_consensus", "unresolved", "failed"]),
    finalSummary: z.string().min(1),
    representativeSpeech: z.string().min(1),
    claims: z.array(ClaimSchema),
    claimResolutions: z.array(ClaimResolutionSchema),
    scoreboard: z.array(ParticipantScoreSchema),
    disagreements: z.array(z.object({
      claimId: z.string().min(1),
      participantId: z.string().min(1),
      reason: z.string().min(1)
    })).optional()
  }),
  fullResult: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional()
});

export type ActionTaskInput = z.infer<typeof ActionTaskInputSchema>;

export const ActionTaskResultSchema = z.object({
  kind: z.literal("action"),
  output: z.object({
    fullResponse: z.string().min(1),
    summary: z.string().min(1)
  })
});

export type ActionTaskResult = z.infer<typeof ActionTaskResultSchema>;
```

Update the discriminated unions:

```typescript
export const AgentTaskInputSchema = z.discriminatedUnion("kind", [
  RoundTaskInputSchema,
  ReportTaskInputSchema,
  ActionTaskInputSchema
]);

export const AgentTaskResultSchema = z.discriminatedUnion("kind", [
  RoundTaskResultSchema,
  ReportTaskResultSchema,
  ActionTaskResultSchema
]);
```

- [ ] **Step 4: Add action event types to events.ts**

Update `ArgueEventTypeSchema` to include:

```typescript
export const ArgueEventTypeSchema = z.enum([
  "SessionStarted",
  "RoundDispatched",
  "ParticipantResponded",
  "ParticipantEliminated",
  "ClaimsMerged",
  "RoundCompleted",
  "EarlyStopTriggered",
  "GlobalDeadlineHit",
  "ConsensusDrafted",
  "ReportDispatched",
  "ReportCompleted",
  "ActionDispatched",
  "ActionCompleted",
  "ActionFailed",
  "Finalized",
  "Failed"
]);
```

- [ ] **Step 5: Export new types from index.ts**

Add to the type exports:

```typescript
export type { ActionTaskInput, ActionTaskResult } from "./contracts/task.js";
export { ActionTaskInputSchema, ActionTaskResultSchema } from "./contracts/task.js";
export type { ActionOutput } from "./contracts/result.js";
export { ActionOutputSchema } from "./contracts/result.js";
```

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `npm test`
Expected: all existing tests pass (schemas are backward-compatible since all new fields are optional)

- [ ] **Step 7: Commit**

```bash
git add packages/argue/src/contracts/result.ts packages/argue/src/contracts/request.ts \
  packages/argue/src/contracts/task.ts packages/argue/src/contracts/events.ts \
  packages/argue/src/index.ts
git commit -m "feat(argue): add action schemas to contracts (actionPolicy, ActionTaskInput, ActionOutput)"
```

---

## Task 3: Implement action execution in engine

**Files:**
- Modify: `packages/argue/src/core/engine.ts:245-310` (between report and finalize)
- Modify: `packages/argue/test/engine.test.ts`

- [ ] **Step 1: Write failing test for action dispatch**

Add to `packages/argue/test/engine.test.ts`:

```typescript
it("dispatches action task when actionPolicy is set", async () => {
  const timeline: Array<{ type: string; payload?: Record<string, unknown> }> = [];

  // Use a scenario where all agents agree
  const scenarios = buildScenarios(["a1", "a2"]);
  const engine = new ArgueEngine({
    taskDelegate: new StubAgentTaskDelegate(scenarios),
    observer: {
      onEvent(event) {
        timeline.push({ type: event.type, payload: event.payload });
      }
    }
  });

  const result = await engine.start({
    requestId: "action-test",
    task: "Test action",
    participants: [
      { id: "a1", role: "reviewer" },
      { id: "a2", role: "reviewer" }
    ],
    roundPolicy: { minRounds: 1, maxRounds: 1 },
    actionPolicy: {
      prompt: "Fix the issues found.",
      includeFullResult: true
    }
  });

  const dispatched = timeline.find((e) => e.type === "ActionDispatched");
  expect(dispatched).toBeDefined();
  expect(dispatched?.payload?.prompt).toBe("Fix the issues found.");

  const completed = timeline.find((e) => e.type === "ActionCompleted" || e.type === "ActionFailed");
  expect(completed).toBeDefined();

  expect(result.action).toBeDefined();
  expect(result.action?.actorId).toBe(result.representative.participantId);
});

it("skips action when actionPolicy is not set", async () => {
  const timeline: Array<{ type: string }> = [];
  const scenarios = buildScenarios(["a1", "a2"]);
  const engine = new ArgueEngine({
    taskDelegate: new StubAgentTaskDelegate(scenarios),
    observer: { onEvent(event) { timeline.push({ type: event.type }); } }
  });

  const result = await engine.start({
    requestId: "no-action",
    task: "Test no action",
    participants: [{ id: "a1" }, { id: "a2" }],
    roundPolicy: { minRounds: 1, maxRounds: 1 }
  });

  expect(timeline.some((e) => e.type === "ActionDispatched")).toBe(false);
  expect(result.action).toBeUndefined();
});

it("action failure does not invalidate debate result", async () => {
  const timeline: Array<{ type: string }> = [];
  const scenarios = buildScenarios(["a1", "a2"]);

  // Create a delegate that fails action tasks
  const baseDelegate = new StubAgentTaskDelegate(scenarios);
  const failingDelegate: AgentTaskDelegate = {
    async dispatch(task) {
      if (task.kind === "action") {
        throw new Error("Action agent crashed");
      }
      return baseDelegate.dispatch(task);
    },
    async awaitResult(taskId, timeoutMs) {
      return baseDelegate.awaitResult(taskId, timeoutMs);
    }
  };

  const engine = new ArgueEngine({
    taskDelegate: failingDelegate,
    observer: { onEvent(event) { timeline.push({ type: event.type }); } }
  });

  const result = await engine.start({
    requestId: "action-fail",
    task: "Test action failure",
    participants: [{ id: "a1" }, { id: "a2" }],
    roundPolicy: { minRounds: 1, maxRounds: 1 },
    actionPolicy: { prompt: "Do something" }
  });

  expect(result.status).not.toBe("failed");
  expect(result.action?.status).toBe("failed");
  expect(result.action?.error).toBeDefined();
  expect(timeline.some((e) => e.type === "ActionFailed")).toBe(true);
  expect(timeline.some((e) => e.type === "Finalized")).toBe(true);
});
```

Note: The test helper `buildScenarios` and `StubAgentTaskDelegate` already exist in the test file. The `StubAgentTaskDelegate` needs to handle `kind="action"` — check the existing implementation and extend if needed: when it receives `kind="action"`, it should return a successful result with `{ kind: "action", output: { fullResponse: "action done", summary: "action summary" } }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine.test.ts` from `packages/argue`
Expected: FAIL — `actionPolicy` is not recognized, `executeAction` doesn't exist

- [ ] **Step 3: Implement executeAction in engine.ts**

Add a new private method `executeAction` to `ArgueEngine`, modeled after `composeReport`:

```typescript
private async executeAction(args: {
  normalized: NormalizedArgueStartInput;
  requestId: string;
  sessionId: string;
  result: ArgueResult;
  activeParticipants: Set<string>;
}): Promise<ActionOutput | undefined> {
  const policy = args.normalized.actionPolicy;
  if (!policy?.prompt) return undefined;

  const actorId = policy.actorId ?? args.result.representative.participantId;
  if (!args.activeParticipants.has(actorId)) {
    return {
      actorId,
      status: "failed",
      error: `Action actor '${actorId}' is not an active participant`
    };
  }

  const actionSessionId = `${args.normalized.sessionPolicy.sessionKeyPrefix ?? "argue"}:${args.sessionId}:action:${actorId}`;

  const task: ActionTaskInput = {
    kind: "action",
    sessionId: actionSessionId,
    requestId: args.requestId,
    participantId: actorId,
    prompt: policy.prompt,
    argueResult: {
      status: args.result.status,
      finalSummary: args.result.report.finalSummary,
      representativeSpeech: args.result.report.representativeSpeech,
      claims: args.result.finalClaims,
      claimResolutions: args.result.claimResolutions,
      scoreboard: args.result.scoreboard,
      disagreements: args.result.disagreements
    },
    ...(policy.includeFullResult ? { fullResult: JSON.parse(JSON.stringify(args.result)) } : {}),
    metadata: {
      constraints: args.normalized.constraints,
      context: args.normalized.context
    }
  };

  await this.emit(args.normalized, args.sessionId, "ActionDispatched", {
    actorId,
    prompt: policy.prompt
  });

  let dispatched: Awaited<ReturnType<AgentTaskDelegate["dispatch"]>>;
  try {
    dispatched = await this.deps.taskDelegate.dispatch(task as AgentTaskInput);
  } catch (error) {
    const output: ActionOutput = {
      actorId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
    await this.emit(args.normalized, args.sessionId, "ActionFailed", {
      actorId, reason: "dispatch_failed"
    });
    return output;
  }

  let awaited: Awaited<ReturnType<AgentTaskDelegate["awaitResult"]>>;
  try {
    awaited = await this.deps.taskDelegate.awaitResult(
      dispatched.taskId,
      args.normalized.waitingPolicy.perTaskTimeoutMs
    );
  } catch (error) {
    const output: ActionOutput = {
      actorId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
    await this.emit(args.normalized, args.sessionId, "ActionFailed", {
      actorId, reason: "await_failed"
    });
    return output;
  }

  if (!awaited.ok || !awaited.output) {
    const output: ActionOutput = {
      actorId,
      status: "failed",
      error: awaited.ok ? "no output" : (awaited.error ?? "task_failed")
    };
    await this.emit(args.normalized, args.sessionId, "ActionFailed", {
      actorId, reason: "task_failed"
    });
    return output;
  }

  const parsed = ActionTaskResultSchema.safeParse(awaited.output);
  if (!parsed.success) {
    const output: ActionOutput = {
      actorId,
      status: "failed",
      error: "Failed to parse action output"
    };
    await this.emit(args.normalized, args.sessionId, "ActionFailed", {
      actorId, reason: "parse_failed"
    });
    return output;
  }

  await this.emit(args.normalized, args.sessionId, "ActionCompleted", {
    actorId,
    summary: parsed.data.output.summary
  });

  return {
    actorId,
    status: "completed",
    fullResponse: parsed.data.output.fullResponse,
    summary: parsed.data.output.summary
  };
}
```

Then in the `start()` method, insert the action step between result construction and finalization. Modify the area around lines 268-310:

```typescript
// After line 294 (ArgueResult is built), before state.transition("finished"):

// Execute action if configured
const actionOutput = await this.executeAction({
  normalized,
  requestId: normalized.requestId,
  sessionId,
  result,
  activeParticipants
});

if (actionOutput) {
  (result as Record<string, unknown>).action = actionOutput;
}

state.transition("finished");
// ... rest unchanged
```

Import `ActionTaskInput`, `ActionTaskResultSchema`, and `ActionOutput` at the top of engine.ts.

- [ ] **Step 4: Update emit type to include new event types**

In the `emit` method signature (around line 809), add the new event types to the union:

```typescript
| "ActionDispatched"
| "ActionCompleted"
| "ActionFailed"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/engine.test.ts` from `packages/argue`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/argue/src/core/engine.ts packages/argue/test/engine.test.ts
git commit -m "feat(argue): implement action execution in engine with dispatch/await/fallback"
```

---

## Task 4: CLI — add action to run input, run plan, and flags

**Files:**
- Modify: `packages/argue-cli/src/run-input.ts:4-21`
- Modify: `packages/argue-cli/src/run-plan.ts:28-59,139-165`
- Modify: `packages/argue-cli/src/index.ts` (flag parsing and help text)

- [ ] **Step 1: Add action to RunInputSchema**

In `packages/argue-cli/src/run-input.ts`, add to `RunInputSchema`:

```typescript
action: z.object({
  prompt: z.string().min(1),
  actorId: z.string().min(1).optional()
}).strict().optional()
```

- [ ] **Step 2: Add actionPolicy to ResolvedRunPlan.startInput**

In `packages/argue-cli/src/run-plan.ts`, add `actionPolicy` to the `startInput` type:

```typescript
actionPolicy?: {
  prompt: string;
  actorId?: string;
  includeFullResult?: boolean;
}
```

In `resolveRunPlan`, add resolution logic (after composer/trace resolution):

```typescript
const actionPrompt = overrides.action ?? runInput.action?.prompt;
const actionActorId = overrides.actionAgent ?? runInput.action?.actorId;
const actionPolicy = actionPrompt
  ? { prompt: actionPrompt, ...(actionActorId ? { actorId: actionActorId } : {}), includeFullResult: true }
  : undefined;
```

Include in returned `startInput`:

```typescript
...(actionPolicy ? { actionPolicy } : {})
```

- [ ] **Step 3: Add CLI flags**

In `packages/argue-cli/src/index.ts`:

Add to the options type:

```typescript
action?: string;
actionAgent?: string;
```

Add flag parsing in the run options parser:

```typescript
if (arg === "--action") {
  const value = args[i + 1];
  if (!value) return { ok: false, error: "--action requires a prompt" };
  out.action = value;
  i += 1;
  continue;
}

if (arg === "--action-agent") {
  const value = args[i + 1];
  if (!value) return { ok: false, error: "--action-agent requires an agent id" };
  out.actionAgent = value;
  i += 1;
  continue;
}
```

Update help text to include:

```
  argue run|exec [options]        # run a debate session
    ...
    --action <prompt>              # execute action after debate
    --action-agent <id>            # override action actor (default: representative)
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/run-input.ts packages/argue-cli/src/run-plan.ts \
  packages/argue-cli/src/index.ts
git commit -m "feat(argue-cli): add --action and --action-agent flags with run input support"
```

---

## Task 5: CLI — handle action task in runtime and output

**Files:**
- Modify: `packages/argue-cli/src/runtime/task-output.ts`
- Modify: `packages/argue-cli/src/runtime/prompt.ts`
- Modify: `packages/argue-cli/src/output.ts`
- Modify: `packages/argue-cli/test/output.test.ts`

- [ ] **Step 1: Handle kind="action" in task-output.ts**

In `normalizeTaskOutput`, add handling for action tasks:

```typescript
if (task.kind === "action") {
  // Action output is free-form text; wrap it
  const text = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
  return {
    kind: "action",
    output: {
      fullResponse: text,
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text
    }
  };
}
```

In `normalizeTaskOutputFromText`, the action case needs special handling since action agents
produce free-form text, not JSON:

```typescript
export function normalizeTaskOutputFromText(task: AgentTaskInput, text: string): AgentTaskResult {
  if (task.kind === "action") {
    // Action output is free-form — don't try to parse as JSON
    return {
      kind: "action",
      output: {
        fullResponse: text,
        summary: text.length > 200 ? text.slice(0, 200) + "..." : text
      }
    };
  }
  return normalizeTaskOutput(task, parseJsonObject(text));
}
```

In `getTaskOutputJsonSchema`, add:

```typescript
if (task.kind === "action") {
  return {}; // no schema enforcement for action
}
```

- [ ] **Step 2: Handle kind="action" in prompt.ts**

In `buildTaskPrompt`, the action task needs a different prompt structure:

```typescript
export function buildTaskPrompt(args: {
  task: AgentTaskInput;
  agent: ResolvedAgentRuntime;
  includeJsonSchema: boolean;
}): string {
  const { task, agent, includeJsonSchema } = args;

  if (task.kind === "action") {
    return buildActionPrompt(task, agent);
  }

  // ... existing code unchanged
}

function buildActionPrompt(task: ActionTaskInput, agent: ResolvedAgentRuntime): string {
  const sections: string[] = [
    "You are executing an action based on a completed argue debate session.",
    "The debate has concluded and you are now tasked with performing real-world operations based on the outcome."
  ];

  if (agent.role) {
    sections.push(`Role: ${agent.role}`);
  }

  if (agent.systemPrompt) {
    sections.push("", "System instructions:", agent.systemPrompt);
  }

  sections.push("", "Action instructions:", task.prompt);

  sections.push(
    "", "Debate result:",
    `Status: ${task.argueResult.status}`,
    "", "Summary:", task.argueResult.finalSummary,
    "", "Representative statement:", task.argueResult.representativeSpeech
  );

  if (task.argueResult.claims.length > 0) {
    sections.push("", "Claims:");
    for (const claim of task.argueResult.claims) {
      const resolution = task.argueResult.claimResolutions.find((r) => r.claimId === claim.claimId);
      const voteStr = resolution ? ` (${resolution.acceptCount}/${resolution.totalVoters} accept)` : "";
      sections.push(`- ${claim.claimId}: ${claim.title}${voteStr}`);
      sections.push(`  ${claim.statement}`);
    }
  }

  if (task.fullResult) {
    sections.push("", "Full result JSON:", JSON.stringify(task.fullResult, null, 2));
  }

  return sections.join("\n");
}
```

Import `ActionTaskInput` type at the top.

- [ ] **Step 3: Add action event handlers to output.ts**

In the `createEventHandler` method, add handlers for the three action events:

```typescript
if (event.type === "ActionDispatched") {
  const actorId = readString(payload.actorId) ?? "unknown";
  const prompt = readString(payload.prompt) ?? "";
  io.log(`${tag} ${c.magenta(`action dispatched -> ${actorId}`)}`);
  if (verbose && prompt) {
    io.log(c.dim(`  prompt: ${singleLine(prompt)}`));
  }
  return;
}

if (event.type === "ActionCompleted") {
  const actorId = readString(payload.actorId) ?? "unknown";
  const summary = readString(payload.summary);
  io.log(`${tag} ${c.green(`action completed by ${actorId}`)}`);
  if (summary) {
    io.log(c.dim(`  ${singleLine(summary)}`));
  }
  return;
}

if (event.type === "ActionFailed") {
  const actorId = readString(payload.actorId) ?? "unknown";
  const reason = readString(payload.reason) ?? "unknown";
  io.log(`${tag} ${c.red(`action failed for ${actorId}`)} ${c.dim(`(${reason})`)}`);
  return;
}
```

- [ ] **Step 4: Add verbose action output in runCompleted**

In `printVerboseResult`, after eliminations section, add:

```typescript
if (result.action) {
  io.log("");
  io.log(c.bold("  Action:"));
  const statusColor = result.action.status === "completed" ? c.green : c.red;
  io.log(`  ${statusColor(result.action.status)} by ${result.action.actorId}`);
  if (result.action.summary) {
    io.log(`  ${result.action.summary}`);
  }
  if (result.action.error) {
    io.log(`  ${c.red(`error: ${result.action.error}`)}`);
  }
  if (result.action.fullResponse && verbose) {
    io.log(c.dim("  ┌ full response:"));
    io.log(indent(c.dim(result.action.fullResponse), "  │ "));
    io.log(c.dim("  └"));
  }
}
```

- [ ] **Step 5: Add tests for action events in output.test.ts**

```typescript
it("shows action dispatched event", () => {
  const io = createIO();
  const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
  const handler = fmt.createEventHandler();

  handler({
    type: "ActionDispatched",
    at: new Date().toISOString(),
    requestId: "req-1",
    sessionId: "sess-1",
    payload: { actorId: "agent-a", prompt: "Fix the bugs." }
  });

  const all = io.logs.join("\n");
  expect(all).toContain("action dispatched");
  expect(all).toContain("agent-a");
  expect(all).toContain("Fix the bugs.");
});

it("shows action completed event", () => {
  const io = createIO();
  const fmt = createOutputFormatter(io, { noColor: true });
  const handler = fmt.createEventHandler();

  handler({
    type: "ActionCompleted",
    at: new Date().toISOString(),
    requestId: "req-1",
    sessionId: "sess-1",
    payload: { actorId: "agent-a", summary: "Fixed 3 issues." }
  });

  const all = io.logs.join("\n");
  expect(all).toContain("action completed");
  expect(all).toContain("Fixed 3 issues.");
});
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/argue-cli/src/runtime/task-output.ts packages/argue-cli/src/runtime/prompt.ts \
  packages/argue-cli/src/output.ts packages/argue-cli/test/output.test.ts
git commit -m "feat(argue-cli): handle action tasks in runtime, prompt builder, and output"
```

---

## Task 6: CLI — `argue act` sub-command

**Files:**
- Modify: `packages/argue-cli/src/index.ts`
- Modify: `packages/argue-cli/test/index-branches.test.ts`

- [ ] **Step 1: Add `argue act` command routing**

In the command dispatch section of `runCli` (after the `config` command check), add:

```typescript
if (command === "act") {
  return runAction(rest, io);
}
```

- [ ] **Step 2: Implement runAction function**

```typescript
async function runAction(
  args: string[],
  io: Pick<typeof console, "log" | "error">
): Promise<CliResult> {
  const parsed = parseActOptions(args);
  if (!parsed.ok) {
    io.error(parsed.error);
    return { ok: false, code: 1 };
  }

  const { resultPath, task, agent: agentId, configPath } = parsed.value;

  // Load result
  let resultJson: unknown;
  try {
    resultJson = await readJsonFile(resultPath);
  } catch (error) {
    io.error(`Failed to read result file: ${resultPath} (${String(error)})`);
    return { ok: false, code: 1 };
  }

  const resultParsed = ArgueResultSchema.safeParse(resultJson);
  if (!resultParsed.success) {
    io.error(`Invalid result file: ${resultPath}`);
    return { ok: false, code: 1 };
  }

  const result = resultParsed.data;
  const actorId = agentId ?? result.representative.participantId;

  // Load config for provider/agent resolution
  const loadedConfig = await loadCliConfig({ explicitPath: configPath });
  const taskDelegate = await createTaskDelegate({
    loadedConfig,
    plan: { startInput: { requestId: result.requestId } } as ResolvedRunPlan
  });

  const actionTask: ActionTaskInput = {
    kind: "action",
    sessionId: `argue:act:${result.sessionId}`,
    requestId: result.requestId,
    participantId: actorId,
    prompt: task,
    argueResult: {
      status: result.status,
      finalSummary: result.report.finalSummary,
      representativeSpeech: result.report.representativeSpeech,
      claims: result.finalClaims,
      claimResolutions: result.claimResolutions,
      scoreboard: result.scoreboard,
      disagreements: result.disagreements
    },
    fullResult: resultJson as Record<string, unknown>
  };

  try {
    const dispatched = await taskDelegate.dispatch(actionTask as AgentTaskInput);
    const awaited = await taskDelegate.awaitResult(dispatched.taskId);

    if (!awaited.ok) {
      io.error(`Action failed: ${awaited.error ?? "unknown error"}`);
      return { ok: false, code: 1 };
    }

    io.log(awaited.output?.kind === "action"
      ? (awaited.output as ActionTaskResult).output.fullResponse
      : JSON.stringify(awaited.output));

    return { ok: true, code: 0 };
  } catch (error) {
    io.error(`Action failed: ${String(error)}`);
    return { ok: false, code: 1 };
  }
}

function parseActOptions(args: string[]):
  | { ok: true; value: { resultPath: string; task: string; agent?: string; configPath?: string } }
  | { ok: false; error: string } {
  let resultPath: string | undefined;
  let task: string | undefined;
  let agent: string | undefined;
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--result") {
      const v = args[i + 1];
      if (!v) return { ok: false, error: "--result requires a path" };
      resultPath = v;
      i += 1;
    } else if (arg === "--task") {
      const v = args[i + 1];
      if (!v) return { ok: false, error: "--task requires a prompt" };
      task = v;
      i += 1;
    } else if (arg === "--agent") {
      const v = args[i + 1];
      if (!v) return { ok: false, error: "--agent requires an id" };
      agent = v;
      i += 1;
    } else if (arg === "--config" || arg === "-c") {
      const v = args[i + 1];
      if (!v) return { ok: false, error: "--config requires a path" };
      configPath = v;
      i += 1;
    } else {
      return { ok: false, error: `Unknown option for act: ${arg}` };
    }
  }

  if (!resultPath) return { ok: false, error: "argue act requires --result <path>" };
  if (!task) return { ok: false, error: "argue act requires --task <prompt>" };

  return { ok: true, value: { resultPath, task, agent, configPath } };
}
```

Import `ArgueResultSchema`, `ActionTaskInput`, `ActionTaskResult` at the top.

- [ ] **Step 3: Update help text**

```typescript
io.log("  argue act --result <path> --task <prompt> [--agent <id>] [--config <path>]");
```

- [ ] **Step 4: Add basic tests for argue act**

```typescript
it("returns error for missing act options", async () => {
  const io = createIO();

  const noResult = await runCli(["act", "--task", "do stuff"], io);
  expect(noResult).toEqual({ ok: false, code: 1 });
  expect(io.errors.some((x) => x.includes("--result"))).toBe(true);

  const io2 = createIO();
  const noTask = await runCli(["act", "--result", "r.json"], io2);
  expect(noTask).toEqual({ ok: false, code: 1 });
  expect(io2.errors.some((x) => x.includes("--task"))).toBe(true);
});
```

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 6: Commit and push**

```bash
git add packages/argue-cli/src/index.ts packages/argue-cli/test/index-branches.test.ts
git commit -m "feat(argue-cli): add argue act sub-command for standalone action execution"
git push
```

---

## Summary of commits

1. `feat(argue-cli): enrich summary.md with claims, stances, scoreboard, and metrics`
2. `feat(argue): add action schemas to contracts (actionPolicy, ActionTaskInput, ActionOutput)`
3. `feat(argue): implement action execution in engine with dispatch/await/fallback`
4. `feat(argue-cli): add --action and --action-agent flags with run input support`
5. `feat(argue-cli): handle action tasks in runtime, prompt builder, and output`
6. `feat(argue-cli): add argue act sub-command for standalone action execution`
