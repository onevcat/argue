import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { CliProviderConfig } from "../config.js";
import { buildTaskPrompt } from "./prompt.js";
import { normalizeTaskOutput, normalizeTaskOutputFromText } from "./task-output.js";
import type { ProviderTaskRunner } from "./types.js";

export function createCliRunner(provider: CliProviderConfig): ProviderTaskRunner {
  const sessionUUID = randomUUID();
  let callCount = 0;

  return {
    async runTask({ task, agent, abortSignal }) {
      const prompt =
        provider.cliType === "generic"
          ? JSON.stringify(buildGenericEnvelope(task, agent), null, 2)
          : buildTaskPrompt({ task, agent, includeJsonSchema: true });

      const hasSession = !!task.metadata?.participantSessionKey;
      const isResume = hasSession && callCount > 0;
      callCount++;
      const baseArgs = buildBaseArgs(
        provider.cliType,
        agent.providerModel,
        prompt,
        hasSession ? sessionUUID : undefined,
        isResume
      );
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
        stdin: usesStdinPrompt(provider.cliType) ? prompt : "",
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

/** Returns true if the CLI tool reads the prompt from stdin, false if it goes in args. */
function usesStdinPrompt(cliType: CliProviderConfig["cliType"]): boolean {
  switch (cliType) {
    case "claude":
    case "codex":
    case "gemini":
    case "pi":
    case "generic":
      return true;
    case "copilot":
    case "opencode":
    case "amp":
      return false;
    case "droid":
    default:
      return true;
  }
}

function buildBaseArgs(
  cliType: CliProviderConfig["cliType"],
  providerModel: string,
  prompt: string,
  sessionUUID?: string,
  isResume?: boolean
): string[] {
  switch (cliType) {
    case "claude":
      if (sessionUUID && isResume) {
        return ["--print", "--model", providerModel, "--resume", sessionUUID];
      }
      return [
        "--print",
        "--model",
        providerModel,
        ...(sessionUUID ? ["--session-id", sessionUUID] : ["--no-session-persistence"])
      ];
    case "codex":
      return ["exec", "-m", providerModel, "--full-auto", "--color", "never"];
    case "copilot":
      return ["-p", prompt, "--yolo", "--model", providerModel];
    case "gemini":
      return ["--approval-mode", "yolo", "-m", providerModel];
    case "pi": {
      const sessionArgs = sessionUUID ? ["--session", join(tmpdir(), `argue-pi-${sessionUUID}`)] : [];
      return ["--model", providerModel, ...sessionArgs];
    }
    case "opencode":
      return ["run", prompt, "--dangerously-skip-permissions", "-m", providerModel];
    case "droid":
      return ["exec", "--auto", "high", "-m", providerModel];
    case "amp":
      return ["-x", prompt, "--dangerously-allow-all"];
    default:
      return [];
  }
}

function buildGenericEnvelope(
  task: Parameters<typeof buildTaskPrompt>[0]["task"],
  agent: Parameters<typeof buildTaskPrompt>[0]["agent"]
): Record<string, unknown> {
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

  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, renderTemplate(value, task, agent)]));
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

      reject(
        new Error(`CLI provider exited with code=${code ?? "null"} signal=${signal ?? "null"} stderr=${stderr.trim()}`)
      );
    });

    child.stdin.end(args.stdin);
  });
}
