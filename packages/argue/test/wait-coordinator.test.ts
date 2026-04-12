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
              taskTitle: "demo task",
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

  it("emits onTaskSettled in completion order with settled timestamps", async () => {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const events: Array<{ taskId: string; status: string; at: string }> = [];

    const delegate: AgentTaskDelegate = {
      async dispatch() {
        throw new Error("not used");
      },
      async awaitResult(taskId) {
        if (taskId === "fast") {
          await sleep(5);
          return {
            ok: true,
            output: {
              kind: "round",
              output: {
                participantId: "a-fast",
                phase: "debate",
                round: 1,
                fullResponse: "fast",
                summary: "fast",
                judgements: []
              }
            }
          };
        }

        if (taskId === "timeout") {
          await sleep(10);
          return {
            ok: false,
            error: "__timeout__"
          };
        }

        await sleep(20);
        return {
          ok: true,
          output: {
            kind: "round",
            output: {
              participantId: "a-slow",
              phase: "debate",
              round: 1,
              fullResponse: "slow",
              summary: "slow",
              judgements: []
            }
          }
        };
      }
    };

    const coordinator = new DefaultWaitCoordinator(delegate);
    const result = await coordinator.waitRound({
      round: 1,
      taskIds: ["slow", "fast", "timeout"],
      policy: {
        perTaskTimeoutMs: 100,
        perRoundTimeoutMs: 100
      },
      onTaskSettled(event) {
        events.push({ taskId: event.taskId, status: event.status, at: event.at });
      }
    });

    expect(result.completed.map((x) => x.participantId).sort()).toEqual(["a-fast", "a-slow"]);
    expect(result.failedTaskIds).toEqual([]);
    expect(result.timedOutTaskIds).toEqual(["timeout"]);

    expect(events.map((x) => `${x.taskId}:${x.status}`)).toEqual([
      "fast:completed",
      "timeout:timeout",
      "slow:completed"
    ]);

    for (const event of events) {
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
    }
  });
});
