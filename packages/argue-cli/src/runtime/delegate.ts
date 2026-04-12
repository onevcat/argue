import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentTaskDelegate, AgentTaskInput, AgentTaskResult } from "@onevcat/argue";
import type { LoadedCliConfig, ProviderConfig } from "../config.js";
import type { ResolvedRunPlan } from "../run-plan.js";
import { createApiRunner } from "./api.js";
import { createCliRunner } from "./cli.js";
import { JsonParseError } from "./json.js";
import { createMockRunner } from "./mock.js";
import { createSdkRunner } from "./sdk.js";
import { normalizeTaskOutput } from "./task-output.js";
import type { ProviderTaskRunner, ResolvedAgentRuntime } from "./types.js";

type TaskEntry = {
  controller: AbortController;
  promise: Promise<AgentTaskResult>;
  timeoutMs?: number;
  task: AgentTaskInput;
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

  // Every artefact for a given run lives under the same directory; we
  // derive it once from the plan so that raw-error dumps land next to
  // events.jsonl / error.json / result.json.
  const runDir = dirname(args.plan.jsonlPath);

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
        timeoutMs: agent.timeoutMs,
        task
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

        // On JSON parse failure, persist the raw agent output to disk
        // so the failure can be inspected after the run exits. We do
        // this on a best-effort basis — if the dump itself fails we
        // still propagate the original error to the engine.
        if (error instanceof JsonParseError) {
          try {
            const dumpPath = await persistRawParseError(runDir, entry.task, error);
            process.stderr.write(`[argue] raw agent output saved to: ${dumpPath}\n`);
          } catch {
            // Swallow dump failures; the parse error still propagates.
          }
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

/**
 * Write a raw agent payload to a `raw-error-*.txt` file under the run
 * directory so the failure can be inspected post-mortem. The filename
 * encodes participant, phase, and round so the same participant can
 * fail multiple times in the same run without clobbering earlier
 * captures. Returns the absolute path that was written.
 */
async function persistRawParseError(runDir: string, task: AgentTaskInput, error: JsonParseError): Promise<string> {
  await mkdir(runDir, { recursive: true });

  const filename = buildRawErrorFilename(task);
  const dumpPath = join(runDir, filename);

  const header = [
    `# argue raw agent output — JSON parse failure`,
    `# taskKind: ${task.kind}`,
    ...(task.kind === "round" ? [`# phase: ${task.phase}`, `# round: ${task.round}`] : []),
    `# participantId: ${task.participantId}`,
    `# requestId: ${task.requestId}`,
    `# sessionId: ${task.sessionId}`,
    `# error: ${error.message}`,
    ``,
    `# --- raw text (as returned by the runner) ---`,
    error.rawText,
    ``,
    `# --- extracted candidate (post code-fence / brace-balance) ---`,
    error.extractedCandidate ?? "(no candidate extracted)",
    ``
  ].join("\n");

  await writeFile(dumpPath, header, "utf8");
  return dumpPath;
}

function buildRawErrorFilename(task: AgentTaskInput): string {
  const safeParticipant = sanitiseFilenameSegment(task.participantId);
  if (task.kind === "round") {
    return `raw-error-${safeParticipant}-${task.phase}-${task.round}.txt`;
  }
  return `raw-error-${safeParticipant}-${task.kind}.txt`;
}

function sanitiseFilenameSegment(input: string): string {
  // Keep things simple — strip anything that could break path handling
  // on any host filesystem. Participant IDs are typically already ASCII.
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}
