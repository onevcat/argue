import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { CliProviderConfig } from "../config.js";
import { buildTaskPrompt } from "./prompt.js";
import { normalizeTaskOutput, normalizeTaskOutputFromText } from "./task-output.js";
import type { ProviderTaskRunner } from "./types.js";

export function createCliRunner(provider: CliProviderConfig): ProviderTaskRunner {
  const sessionUUID = randomUUID();

  return {
    async runTask({ task, agent, abortSignal }) {
      const stdin = provider.cliType === "generic"
        ? JSON.stringify(buildGenericEnvelope(task, agent), null, 2)
        : buildTaskPrompt({ task, agent, includeJsonSchema: true });

      const hasSession = !!task.metadata?.participantSessionKey;
      const baseArgs = buildBaseArgs(provider.cliType, agent.providerModel, hasSession ? sessionUUID : undefined);
      const extraArgs = provider.args.map((arg) => renderTemplate(arg, task, agent));

      const result = await runCommand({
        command: provider.command,
        args: [...baseArgs, ...extraArgs],
        env: {
          ...process.env,
          ...renderEnv(provider.env, task, agent),
          ARGUE_TASK_KIND: task.kind,
          ARGUE_REQUEST_ID: task.requestId,
          ARGUE_SESSION_ID: task.sessionId,
          ARGUE_PARTICIPANT_ID: task.participantId,
          ARGUE_PROVIDER_MODEL: agent.providerModel,
          ...(task.kind === "round"
            ? {
              ARGUE_TASK_PHASE: task.phase,
              ARGUE_TASK_ROUND: String(task.round)
            }
            : {})
        },
        stdin,
        abortSignal
      });

      if (provider.cliType === "generic") {
        try {
          return normalizeTaskOutput(task, JSON.parse(result.stdout.trim()));
        } catch {
          return normalizeTaskOutputFromText(task, result.stdout);
        }
      }

      return normalizeTaskOutputFromText(task, result.stdout);
    }
  };
}

function buildBaseArgs(
  cliType: CliProviderConfig["cliType"],
  providerModel: string,
  sessionUUID?: string
): string[] {
  switch (cliType) {
    case "claude":
      return [
        "--print", "--model", providerModel,
        ...(sessionUUID ? ["--session-id", sessionUUID] : ["--no-session-persistence"])
      ];
    case "codex":
      return [
        "exec", "-m", providerModel, "--full-auto", "--color", "never"
      ];
    default:
      return [];
  }
}

function buildGenericEnvelope(task: Parameters<typeof buildTaskPrompt>[0]["task"], agent: Parameters<typeof buildTaskPrompt>[0]["agent"]): Record<string, unknown> {
  return {
    version: 1,
    agent: {
      id: agent.id,
      role: agent.role,
      provider: agent.provider,
      model: agent.model,
      providerModel: agent.providerModel,
      systemPrompt: agent.systemPrompt,
      temperature: agent.temperature
    },
    task
  };
}

function renderEnv(
  env: CliProviderConfig["env"],
  task: Parameters<typeof buildTaskPrompt>[0]["task"],
  agent: Parameters<typeof buildTaskPrompt>[0]["agent"]
): Record<string, string> {
  if (!env) return {};

  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [key, renderTemplate(value, task, agent)])
  );
}

function renderTemplate(
  template: string,
  task: Parameters<typeof buildTaskPrompt>[0]["task"],
  agent: Parameters<typeof buildTaskPrompt>[0]["agent"]
): string {
  return template
    .replaceAll("{requestId}", task.requestId)
    .replaceAll("{sessionId}", task.sessionId)
    .replaceAll("{participantId}", task.participantId)
    .replaceAll("{taskKind}", task.kind)
    .replaceAll("{providerModel}", agent.providerModel)
    .replaceAll("{agentId}", agent.id)
    .replaceAll("{role}", agent.role ?? "")
    .replaceAll("{phase}", task.kind === "round" ? task.phase : "report")
    .replaceAll("{round}", task.kind === "round" ? String(task.round) : "");
}

async function runCommand(args: {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  stdin: string;
  abortSignal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.command, args.args, {
      env: args.env,
      stdio: "pipe",
      signal: args.abortSignal
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`CLI provider exited with code=${code ?? "null"} signal=${signal ?? "null"} stderr=${stderr.trim()}`));
    });

    child.stdin.end(args.stdin);
  });
}
