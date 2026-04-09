import type { AgentTaskInput } from "argue";
import { describe, expect, it } from "vitest";
import { normalizeTaskOutput, normalizeTaskOutputFromText } from "../src/runtime/task-output.js";

function makeInitialTask(): AgentTaskInput {
  return {
    kind: "round",
    sessionId: "s1",
    requestId: "r1",
    participantId: "a1",
    phase: "initial",
    round: 0,
    prompt: "p",
    claimCatalog: []
  };
}

describe("runtime/task-output", () => {
  it("wraps raw round content with task metadata", () => {
    const task = makeInitialTask();

    const output = normalizeTaskOutput(task, {
      fullResponse: "full",
      summary: "sum",
      extractedClaims: [
        {
          claimId: "c1",
          title: "C1",
          statement: "claim"
        }
      ],
      judgements: []
    });

    expect(output.kind).toBe("round");
    if (output.kind !== "round") {
      throw new Error("expected round output");
    }

    expect(output.output.participantId).toBe("a1");
    expect(output.output.phase).toBe("initial");
    expect(output.output.round).toBe(0);
  });

  it("rejects wrapped round output when participant mismatches task", () => {
    const task = makeInitialTask();

    expect(() => normalizeTaskOutput(task, {
      kind: "round",
      output: {
        participantId: "a2",
        phase: "initial",
        round: 0,
        fullResponse: "full",
        summary: "sum",
        extractedClaims: [],
        judgements: []
      }
    })).toThrow(/participant mismatch/);
  });

  it("parses fenced json text into normalized output", () => {
    const task = makeInitialTask();

    const output = normalizeTaskOutputFromText(
      task,
      "```json\n{\"fullResponse\":\"full\",\"summary\":\"sum\",\"extractedClaims\":[],\"judgements\":[]}\n```"
    );

    expect(output.kind).toBe("round");
    if (output.kind === "round") {
      expect(output.output.summary).toBe("sum");
    }
  });
});
