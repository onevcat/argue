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

    const dispatch = await delegate.dispatch(makeRoundTask({
      requestId: "req-cleanup",
      sessionId: "s1",
      participantId: "a1"
    }));

    const first = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(first.ok).toBe(true);

    const second = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(second.ok).toBe(false);
    expect(second.error).toContain("unknown_task_id");
  });

  it("cleans task record after cancel", async () => {
    const loadedConfig = makeLoadedConfig({ delayMs: 0 });
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

    const dispatch = await delegate.dispatch(makeRoundTask({
      requestId: "req-cancel",
      sessionId: "s2",
      participantId: "a1"
    }));

    await delegate.cancel?.(dispatch.taskId);

    const afterCancel = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(afterCancel.ok).toBe(false);
    expect(afterCancel.error).toContain("unknown_task_id");
  });

  it("throws when dispatching unknown agent id", async () => {
    const loadedConfig = makeLoadedConfig({ delayMs: 0 });
    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "req-unknown-agent",
        topic: "topic",
        objective: "objective"
      }
    });

    const delegate = await createTaskDelegate({ loadedConfig, plan });

    await expect(delegate.dispatch(makeRoundTask({
      requestId: "req-unknown-agent",
      sessionId: "s4",
      participantId: "ghost"
    }))).rejects.toThrow(/Unknown agent id/);
  });

  it("throws on unknown model in agent catalog", async () => {
    const loadedConfig = {
      configPath: "/tmp/argue.config.json",
      configDir: "/tmp",
      config: {
        schemaVersion: 1 as const,
        providers: {
          mock1: {
            type: "mock" as const,
            models: {
              fake: {}
            }
          }
        },
        agents: [
          { id: "a1", provider: "mock1", model: "missing" },
          { id: "a2", provider: "mock1", model: "fake" }
        ]
      }
    };

    const plan = resolveRunPlan({
      loadedConfig: {
        ...loadedConfig,
        config: {
          ...loadedConfig.config,
          agents: [
            { id: "a1", provider: "mock1", model: "fake" },
            { id: "a2", provider: "mock1", model: "fake" }
          ]
        }
      },
      runInput: {},
      overrides: { requestId: "r", topic: "t", objective: "o" }
    });

    await expect(createTaskDelegate({ loadedConfig, plan })).rejects.toThrow(/Unknown model/);
  });
});

function makeRoundTask(args: {
  requestId: string;
  sessionId: string;
  participantId: string;
}): AgentTaskInput {
  return {
    kind: "round",
    sessionId: args.sessionId,
    requestId: args.requestId,
    participantId: args.participantId,
    phase: "initial",
    round: 0,
    prompt: "p",
    claimCatalog: []
  };
}

function makeLoadedConfig(options: { delayMs: number; timeoutMs?: number }) {
  return {
    configPath: "/tmp/argue.config.json",
    configDir: "/tmp",
    config: {
      schemaVersion: 1 as const,
      providers: {
        mock1: {
          type: "mock" as const,
          defaultBehavior: {
            behavior: "deterministic" as const,
            delayMs: options.delayMs
          },
          models: {
            fake: {}
          }
        }
      },
      agents: [
        { id: "a1", provider: "mock1", model: "fake", timeoutMs: options.timeoutMs },
        { id: "a2", provider: "mock1", model: "fake" }
      ]
    }
  };
}
