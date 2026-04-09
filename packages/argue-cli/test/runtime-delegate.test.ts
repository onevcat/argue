import type { AgentTaskInput } from "argue";
import { describe, expect, it } from "vitest";
import { resolveRunPlan } from "../src/run-plan.js";
import { createTaskDelegate } from "../src/runtime/delegate.js";

describe("createTaskDelegate task lifecycle", () => {
  it("cleans task record after awaitResult completes", async () => {
    const loadedConfig = makeLoadedConfig({ delayMs: 0 });
    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "req-cleanup",
        topic: "topic",
        objective: "objective"
      }
    });

    const delegate = await createTaskDelegate({ loadedConfig, plan });

    const task: AgentTaskInput = {
      kind: "round",
      sessionId: "s1",
      requestId: "req-cleanup",
      participantId: "a1",
      phase: "initial",
      round: 0,
      prompt: "p",
      claimCatalog: []
    };

    const dispatch = await delegate.dispatch(task);
    const first = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(first.ok).toBe(true);

    const second = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(second.ok).toBe(false);
    expect(second.error).toContain("unknown_task_id");
  });

  it("cleans task record after cancel", async () => {
    const loadedConfig = makeLoadedConfig({ delayMs: 500 });
    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "req-cancel",
        topic: "topic",
        objective: "objective"
      }
    });

    const delegate = await createTaskDelegate({ loadedConfig, plan });

    const task: AgentTaskInput = {
      kind: "round",
      sessionId: "s2",
      requestId: "req-cancel",
      participantId: "a1",
      phase: "initial",
      round: 0,
      prompt: "p",
      claimCatalog: []
    };

    const dispatch = await delegate.dispatch(task);
    await delegate.cancel?.(dispatch.taskId);

    const afterCancel = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(afterCancel.ok).toBe(false);
    expect(afterCancel.error).toContain("unknown_task_id");
  });
});

function makeLoadedConfig(options: { delayMs: number }) {
  return {
    configPath: "/tmp/argue.config.json",
    configDir: "/tmp",
    config: {
      schemaVersion: 1 as const,
      providers: {
        mock1: {
          type: "mock" as const,
          behavior: "deterministic" as const,
          delayMs: options.delayMs,
          models: {
            fake: {}
          }
        }
      },
      agents: [
        { id: "a1", provider: "mock1", model: "fake" },
        { id: "a2", provider: "mock1", model: "fake" }
      ]
    }
  };
}
