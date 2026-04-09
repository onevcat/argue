import { describe, expect, it } from "vitest";
import type { AgentTaskDelegate } from "../src/contracts/delegate.js";
import { DefaultWaitCoordinator } from "../src/core/wait-coordinator.js";

describe("DefaultWaitCoordinator", () => {
  it("classifies completed, failed, and timed-out tasks and cancels timed out ones", async () => {
    const canceled: string[] = [];

    const delegate: AgentTaskDelegate = {
      async dispatch() {
        throw new Error("not used");
      },
      async awaitResult(taskId) {
        if (taskId === "ok") {
          return {
            ok: true,
            output: {
              kind: "round",
              output: {
                participantId: "a1",
                phase: "debate",
                round: 1,
                fullResponse: "ok",
                summary: "ok",
                judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "ok" }]
              }
            }
          };
        }

        if (taskId === "invalid") {
          return {
            ok: true,
            output: {
              kind: "report",
              output: {
                mode: "representative",
                traceIncluded: false,
                traceLevel: "compact",
                finalSummary: "s",
                representativeSpeech: "r"
              }
            }
          };
        }

        if (taskId === "failed") {
          return {
            ok: false,
            error: "boom"
          };
        }

        return new Promise(() => {});
      },
      async cancel(taskId: string) {
        canceled.push(taskId);
      }
    };

    const coordinator = new DefaultWaitCoordinator(delegate);

    const result = await coordinator.waitRound({
      round: 1,
      taskIds: ["ok", "invalid", "failed", "slow"],
      policy: {
        perTaskTimeoutMs: 10,
        perRoundTimeoutMs: 20
      }
    });

    expect(result.completed.map((x) => x.participantId)).toEqual(["a1"]);
    expect(result.failedTaskIds.sort()).toEqual(["failed", "invalid"]);
    expect(result.timedOutTaskIds).toEqual(["slow"]);
    expect(canceled).toEqual(["slow"]);
  });

  it("treats thrown awaitResult errors as failures", async () => {
    const delegate: AgentTaskDelegate = {
      async dispatch() {
        throw new Error("not used");
      },
      async awaitResult(taskId) {
        if (taskId === "throw") {
          throw new Error("await exploded");
        }
        return {
          ok: true,
          output: {
            kind: "round",
            output: {
              participantId: "a1",
              phase: "initial",
              round: 0,
              fullResponse: "ok",
              summary: "ok",
              extractedClaims: [],
              judgements: []
            }
          }
        };
      }
    };

    const coordinator = new DefaultWaitCoordinator(delegate);
    const result = await coordinator.waitRound({
      round: 0,
      taskIds: ["ok", "throw"],
      policy: {
        perTaskTimeoutMs: 10,
        perRoundTimeoutMs: 50
      }
    });

    expect(result.completed).toHaveLength(1);
    expect(result.failedTaskIds).toEqual(["throw"]);
    expect(result.timedOutTaskIds).toEqual([]);
  });
});
