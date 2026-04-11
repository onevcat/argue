import type { AgentTaskDelegate, AgentTaskInput, AgentTaskResult } from "argue";
import type { LoadedCliConfig, ProviderConfig } from "../config.js";
import type { ResolvedRunPlan } from "../run-plan.js";
import { createApiRunner } from "./api.js";
import { createCliRunner } from "./cli.js";
import { createMockRunner } from "./mock.js";
import { createSdkRunner } from "./sdk.js";
import { normalizeTaskOutput } from "./task-output.js";
import type { ProviderTaskRunner, ResolvedAgentRuntime } from "./types.js";

type TaskEntry = {
  controller: AbortController;
  promise: Promise<AgentTaskResult>;
  timeoutMs?: number;
};

export async function createTaskDelegate(args: {
  loadedConfig: LoadedCliConfig;
  plan: ResolvedRunPlan;
}): Promise<AgentTaskDelegate> {
  const agentCatalog = new Map<string, ResolvedAgentRuntime>();
  for (const agent of args.loadedConfig.config.agents) {
    const providerConfig = args.loadedConfig.config.providers[agent.provider];
    if (!providerConfig) {
      throw new Error(`Unknown provider: ${agent.provider}`);
    }

    const modelConfig = providerConfig.models[agent.model];
    if (!modelConfig) {
      throw new Error(`Unknown model '${agent.model}' for provider '${agent.provider}'`);
    }

    agentCatalog.set(agent.id, {
      ...agent,
      providerName: agent.provider,
      providerConfig,
      modelConfig,
      providerModel: modelConfig.providerModel ?? agent.model
    });
  }

  const runners = new Map<string, Promise<ProviderTaskRunner>>();
  const tasks = new Map<string, TaskEntry>();
  let seq = 0;

  return {
    async dispatch(task: AgentTaskInput) {
      const agent = agentCatalog.get(task.participantId);
      if (!agent) {
        throw new Error(`Unknown agent id: ${task.participantId}`);
      }

      const taskId = `cli-task-${seq++}`;
      const controller = new AbortController();
      const runner = await getRunner(agent);
      const promise = runner
        .runTask({ task, agent, abortSignal: controller.signal })
        .then((result) => normalizeTaskOutput(task, result));

      tasks.set(taskId, {
        controller,
        promise,
        timeoutMs: agent.timeoutMs
      });

      return {
        taskId,
        participantId: task.participantId,
        kind: task.kind
      };
    },

    async awaitResult(taskId: string, timeoutMs?: number) {
      const entry = tasks.get(taskId);
      if (!entry) {
        return { ok: false, error: `unknown_task_id:${taskId}` };
      }

      try {
        const output = await withTimeout(entry.promise, minTimeout(timeoutMs, entry.timeoutMs));
        return { ok: true, output };
      } catch (error) {
        if (error instanceof TimeoutError) {
          entry.controller.abort();
          return { ok: false, error: "__timeout__" };
        }

        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        tasks.delete(taskId);
      }
    },

    async cancel(taskId: string) {
      const entry = tasks.get(taskId);
      if (!entry) return;
      entry.controller.abort();
      tasks.delete(taskId);
    }
  };

  function getRunner(agent: ResolvedAgentRuntime): Promise<ProviderTaskRunner> {
    const cached = runners.get(agent.id);
    if (cached) return cached;

    const provider = args.loadedConfig.config.providers[agent.providerName];
    if (!provider) {
      throw new Error(`Unknown provider: ${agent.providerName}`);
    }

    const created = createRunner(agent.providerName, provider, args.loadedConfig.configDir);
    runners.set(agent.id, created);
    return created;
  }
}

async function createRunner(
  providerName: string,
  provider: ProviderConfig,
  configDir: string
): Promise<ProviderTaskRunner> {
  switch (provider.type) {
  case "api":
    return createApiRunner(providerName, provider);
  case "cli":
    return createCliRunner(provider);
  case "mock":
    return createMockRunner(provider);
  case "sdk":
    return createSdkRunner(providerName, provider, configDir);
  default:
    return assertNever(provider);
  }
}

function minTimeout(left?: number, right?: number): number | undefined {
  if (typeof left !== "number") return right;
  if (typeof right !== "number") return left;
  return Math.min(left, right);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (typeof timeoutMs !== "number" || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

class TimeoutError extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutError";
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled provider: ${String(value)}`);
}
