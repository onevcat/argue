import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArgueEngine } from "../src/core/engine.js";
import { JsonlObserver } from "../src/observers/jsonl-observer.js";
import { JsonlRunEventSchema } from "../src/contracts/run-log.js";
import type { ParticipantRoundOutput } from "../src/contracts/result.js";
import type { AgentTaskResult } from "../src/contracts/task.js";
import { StubAgentTaskDelegate } from "./helpers/stub-agent.js";

function roundResult(output: ParticipantRoundOutput): AgentTaskResult {
  return { kind: "round", output };
}

describe("JsonlObserver", () => {
  it("writes ordered jsonl event records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "argue-jsonl-"));
    const path = join(dir, "events.jsonl");
    const observer = new JsonlObserver({ path, append: false });

    await Promise.all([
      observer.onEvent({ sessionId: "s1", requestId: "r1", type: "SessionStarted", at: "2026-01-01T00:00:00.000Z" }),
      observer.onEvent({ sessionId: "s1", requestId: "r1", type: "RoundDispatched", at: "2026-01-01T00:00:01.000Z" }),
      observer.onEvent({ sessionId: "s1", requestId: "r1", type: "Finalized", at: "2026-01-01T00:00:02.000Z" })
    ]);

    await observer.flush();

    const raw = await readFile(path, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);

    const records = lines.map((line) => JsonlRunEventSchema.parse(JSON.parse(line)));
    expect(records.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(records.map((r) => r.event.type)).toEqual(["SessionStarted", "RoundDispatched", "Finalized"]);
  });

  it("truncates file when append=false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "argue-jsonl-truncate-"));
    const path = join(dir, "events.jsonl");

    await writeFile(path, '{"old":true}\n', "utf8");

    const observer = new JsonlObserver({ path, append: false });
    await observer.onEvent({
      sessionId: "s2",
      requestId: "r2",
      type: "SessionStarted",
      at: "2026-01-02T00:00:00.000Z"
    });
    await observer.flush();

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain('"old"');
    expect(raw.trim().split("\n")).toHaveLength(1);
  });

  it("captures full engine lifecycle events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "argue-jsonl-engine-"));
    const path = join(dir, "events.jsonl");

    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:a": {
        type: "success",
        output: roundResult({
          participantId: "a",
          phase: "initial",
          round: 0,
          fullResponse: "init-a",
          summary: "init-a",
          extractedClaims: [{ title: "c1", statement: "s1" }],
          judgements: []
        })
      },
      "round:initial:0:b": {
        type: "success",
        output: roundResult({
          participantId: "b",
          phase: "initial",
          round: 0,
          fullResponse: "init-b",
          summary: "init-b",
          extractedClaims: [{ title: "c1", statement: "s1" }],
          judgements: []
        })
      },
      "round:debate:1:a": {
        type: "success",
        output: roundResult({
          participantId: "a",
          phase: "debate",
          round: 1,
          fullResponse: "debate-a",
          summary: "debate-a",
          judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "ok" }]
        })
      },
      "round:debate:1:b": {
        type: "success",
        output: roundResult({
          participantId: "b",
          phase: "debate",
          round: 1,
          fullResponse: "debate-b",
          summary: "debate-b",
          judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "ok" }]
        })
      },
      "round:final_vote:2:a": {
        type: "success",
        output: roundResult({
          participantId: "a",
          phase: "final_vote",
          round: 2,
          fullResponse: "vote-a",
          summary: "vote-a",
          judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "ok" }],
          claimVotes: [{ claimId: "c1", vote: "accept" }]
        })
      },
      "round:final_vote:2:b": {
        type: "success",
        output: roundResult({
          participantId: "b",
          phase: "final_vote",
          round: 2,
          fullResponse: "vote-b",
          summary: "vote-b",
          judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "ok" }],
          claimVotes: [{ claimId: "c1", vote: "accept" }]
        })
      }
    };

    const observer = new JsonlObserver({ path, append: false });
    const engine = new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate(scenarios),
      observer
    });

    await engine.start({
      requestId: "req-jsonl",
      task: "jsonl",
      participants: [{ id: "a" }, { id: "b" }],
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    await observer.flush();

    const raw = await readFile(path, "utf8");
    const records = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JsonlRunEventSchema.parse(JSON.parse(line)));

    expect(records.length).toBeGreaterThan(0);
    expect(records[0]?.event.type).toBe("SessionStarted");
    expect(records.at(-1)?.event.type).toBe("Finalized");
    expect(records.map((r) => r.seq)).toEqual(records.map((_, index) => index));
    expect(records.every((r) => r.event.requestId === "req-jsonl")).toBe(true);
  });
});
