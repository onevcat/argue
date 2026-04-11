# Action system v0 plan

## 1. Overview

Action is a post-argue step where a single agent consumes the `ArgueResult` and performs
real-world operations based on the debate outcome. It is the bridge between "agents discuss"
and "something actually happens."

Example flow for PR review:

```
argue run --task "Review PR #42" --agents a,b,c --action "Fix identified bugs and post review comments"
  └─ debate rounds ─► consensus ─► report ─► action (agent fixes code / posts comments)
```

## 2. Design principles

- Action is **optional** — a pure debate topic does not require it.
- Action uses the **existing `AgentTaskDelegate`** — hosts handle `kind="action"` alongside
  `kind="round"` and `kind="report"`. No new runtime concept.
- The action agent defaults to the **representative** (highest-scoring participant) because it
  has the deepest understanding of the debate. The user can override this.
- Action requires a **user-provided prompt** that describes what to do with the result.

## 3. Core library changes (`packages/argue`)

### 3.1 ActionPolicy

Add to `ArgueStartInput`:

```typescript
actionPolicy?: {
  prompt: string;           // required — what the actor should do
  actorId?: string;         // defaults to representative.participantId
  includeFullResult?: boolean; // include full ArgueResult JSON as context (default: true)
}
```

When `actionPolicy` is present and `prompt` is non-empty, the engine dispatches an action
task after report composition.

### 3.2 Action task

New task kind dispatched via `AgentTaskDelegate`:

```typescript
// kind="action" task input
{
  kind: "action",
  requestId: string,
  sessionId: string,         // reuse argue session or new session
  participantId: string,     // the actor
  prompt: string,            // user's action prompt
  argueResult: {             // structured debate outcome
    status: string,
    finalSummary: string,
    representativeSpeech: string,
    claims: Claim[],
    claimResolutions: ClaimResolution[],
    scoreboard: ParticipantScore[],
    disagreements: Disagreement[]
  }
}
```

The `argueResult` field provides structured context. The full `result.json` can be optionally
included via `includeFullResult`.

### 3.3 Action output

Action output is **free-form text** — the agent performs real-world operations (edit files,
post comments, run commands) and its stdout is captured. Unlike debate rounds, there is no
structured JSON schema enforcement.

```typescript
type ActionOutput = {
  actorId: string;
  fullResponse: string;
  summary: string;
};
```

### 3.4 Engine state machine extension

```
initial → debate → final_vote → scoring → report → action → done
                                                      ↑
                                              only if actionPolicy.prompt is set
```

### 3.5 Events

- `ActionDispatched`: `{ actorId, prompt }`
- `ActionCompleted`: `{ actorId, summary }`
- `ActionFailed`: `{ actorId, reason }`

On action failure, the engine completes normally — action failure does not invalidate the
debate result. The `ArgueResult` gains an optional `action` field:

```typescript
action?: {
  actorId: string;
  status: "completed" | "failed";
  summary?: string;
  fullResponse?: string;
  error?: string;
}
```

### 3.6 ArgueResult changes

```typescript
// existing fields unchanged, add:
action?: ActionOutput & { status: "completed" | "failed"; error?: string };
```

## 4. CLI integration (`packages/argue-cli`)

### 4.1 Integrated mode: `--action` on `argue run`

```bash
# action prompt as flag value
argue run --task "Review PR #42" --agents a,b,c \
  --action "Fix all identified bugs and post a summary comment on the PR"

# optionally override actor
argue run ... --action "Fix bugs" --action-agent codex-agent
```

Mapping:

- `--action <prompt>` → `actionPolicy.prompt`
- `--action-agent <id>` → `actionPolicy.actorId` (default: representative)

### 4.2 Run input file (`--input task.json`)

Action can be specified in the existing run input file alongside other run parameters:

```json
{
  "task": "Review PR #42 for security vulnerabilities",
  "agents": ["claude-agent", "codex-agent", "gemini-agent"],
  "minRounds": 2,
  "maxRounds": 4,
  "action": {
    "prompt": "Fix all identified security issues and post a review summary comment on the PR.",
    "actorId": "codex-agent"
  }
}
```

Schema addition to `RunInputSchema`:

```typescript
action: z.object({
  prompt: z.string().min(1),
  actorId: z.string().min(1).optional()
}).optional();
```

Priority: `CLI flags > input JSON (--input) > config defaults`, consistent with existing
override behavior. `--action` CLI flag overrides `action.prompt` from input file.

This allows teams to version-control their argue task definitions including the action step,
and enables automated pipelines (CI/CD) to run the full debate-to-action flow from a single
config file.

### 4.3 Standalone mode: `argue act`

Run action against an existing result, without re-running the debate:

```bash
argue act --result ./result.json \
  --agent codex-agent \
  --task "Fix the bugs found in the review and post PR comments"
```

This reads `result.json`, constructs the action task input, and dispatches it to the
specified agent via the same provider/runner infrastructure.

Required flags:

- `--result <path>` — path to existing `result.json`
- `--task <prompt>` — the action prompt

Optional flags:

- `--agent <id>` — actor agent ID (defaults to representative in the result)
- `--config <path>` — config file (for provider/agent resolution)

### 4.3 Output

Action output is appended to existing artifacts:

- `result.json` is updated with the `action` field (integrated mode)
- A new `action.md` is written with the action summary
- Console output shows action progress via existing event handler

### 4.4 Runtime adapter

The action task is dispatched through `AgentTaskDelegate` like any other task.
CLI providers handle `kind="action"` by building a prompt that includes:

1. The user's action prompt
2. The debate result summary (finalSummary + representativeSpeech)
3. Claim details with resolutions
4. Structured result JSON (optional, controlled by `includeFullResult`)

The prompt is sent to the agent the same way round/report prompts are — via stdin or args
depending on the `cliType`.

## 5. Summary enrichment (prerequisite)

Before action, the summary document needs to be rich enough to serve as actionable context.

### 5.1 `summary.md` improvements

Current format is too sparse. Enrich `buildResultSummary` in `artifacts.ts` to include:

```markdown
# argue run {requestId}

## Metadata

- status / representative / rounds / turns / elapsed time

## Conclusion

{finalSummary}

## Representative statement

{representativeSpeech}

## Claims

For each active claim:

- title, statement, category
- resolution: accept/reject counts
- per-agent stance and confidence from last round

## Scoreboard

Per agent: total score + breakdown (correctness/completeness/actionability/consistency)

## Disagreements

Unresolved disputes with reasons

## Opinion shifts

Notable stance changes across rounds (if trace enabled)
```

### 5.2 Why this matters for action

The action agent reads the summary as its primary context. A richer summary means a
better-informed action. The structured `result.json` is supplementary — the summary
provides the narrative.

## 6. Scope and milestones

### M1: summary enrichment

- Enrich `buildResultSummary` in `artifacts.ts`
- No engine changes, CLI-only

### M2: core action support

- Add `actionPolicy` to request schema
- Add `kind="action"` task contract
- Extend engine state machine with action step
- Add action events and result field
- Tests for engine action flow

### M3: CLI integration

- `--action` and `--action-agent` flags on `argue run`
- `argue act` sub-command
- Action prompt builder in runtime
- E2E tests

## 7. Non-goals (v0)

- Multi-step action chains (action produces new claims → re-debate)
- Action approval/confirmation flow (agent asks human before acting)
- Action rollback / undo
- Parallel action dispatch to multiple agents

These are natural extensions but out of scope for the first version.
