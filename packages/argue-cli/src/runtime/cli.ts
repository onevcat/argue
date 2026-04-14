import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliProviderConfig } from "../config.js";
import { buildTaskPrompt } from "./prompt.js";
import { normalizeTaskOutput, normalizeTaskOutputFromText } from "./task-output.js";
import type { ProviderTaskRunner } from "./types.js";

type BaseArgsResult = {
  args: string[];
  reasoningApplied: boolean;
};

export function createCliRunner(raw: CliProviderConfig): ProviderTaskRunner {
  const provider = { ...raw, command: raw.command ?? raw.cliType };
  const sessionUUID = randomUUID();
  let callCount = 0;
  let warnedUnsupportedReasoning = false;

  return {
    async runTask({ task, agent, abortSignal }) {
      const reasoning = agent.reasoning ?? agent.modelConfig.reasoning;
      const prompt =
        provider.cliType === "generic"
          ? JSON.stringify(buildGenericEnvelope(task, agent, reasoning), null, 2)
          : buildTaskPrompt({ task, agent, includeJsonSchema: true });

      const hasSession = !!task.metadata?.participantSessionKey;
      const isResume = hasSession && callCount > 0;
      callCount++;
      const { args: baseArgs, reasoningApplied } = buildBaseArgs(
        provider.cliType,
        agent.providerModel,
        prompt,
        reasoning,
        hasSession ? sessionUUID : undefined,
        isResume
      );
      const extraArgs = provider.args.map((arg) => renderTemplate(arg, task, agent));

      if (reasoning && !reasoningApplied && !warnedUnsupportedReasoning) {
        warnedUnsupportedReasoning = true;
        warnUnsupportedReasoning(provider.cliType, reasoning);
      }

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
  reasoning?: string,
  sessionUUID?: string,
  isResume?: boolean
): BaseArgsResult {
  switch (cliType) {
    case "claude": {
      const args =
        sessionUUID && isResume
          ? ["--print", "--model", providerModel, "--resume", sessionUUID]
          : [
              "--print",
              "--model",
              providerModel,
              ...(sessionUUID ? ["--session-id", sessionUUID] : ["--no-session-persistence"])
            ];

      return {
        args: reasoning ? [...args, "--effort", reasoning] : args,
        reasoningApplied: !!reasoning
      };
    }
    case "codex": {
      const reasoningArgs = reasoning ? ["-c", `model_reasoning_effort=${reasoning}`] : [];
      return {
        args: ["exec", "-m", providerModel, ...reasoningArgs, "--full-auto", "--color", "never"],
        reasoningApplied: !!reasoning
      };
    }
    case "copilot":
      return { args: ["-p", prompt, "--yolo", "--model", providerModel], reasoningApplied: false };
    case "gemini":
      return { args: ["--approval-mode", "yolo", "-m", providerModel], reasoningApplied: false };
    case "pi": {
      const sessionArgs = sessionUUID ? ["--session", join(tmpdir(), `argue-pi-${sessionUUID}`)] : [];
      return { args: ["--model", providerModel, ...sessionArgs], reasoningApplied: false };
    }
    case "opencode":
      return { args: ["run", prompt, "--dangerously-skip-permissions", "-m", providerModel], reasoningApplied: false };
    case "droid":
      return { args: ["exec", "--auto", "high", "-m", providerModel], reasoningApplied: false };
    case "amp":
      return { args: ["-x", prompt, "--dangerously-allow-all"], reasoningApplied: false };
    case "generic":
      return { args: [], reasoningApplied: !!reasoning };
    default:
      return { args: [], reasoningApplied: false };
  }
}

function buildGenericEnvelope(
  task: Parameters<typeof buildTaskPrompt>[0]["task"],
  agent: Parameters<typeof buildTaskPrompt>[0]["agent"],
  reasoning?: string
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
      temperature: agent.temperature,
      reasoning
    },
    task
  };
}

function warnUnsupportedReasoning(cliType: CliProviderConfig["cliType"], reasoning: string): void {
  process.stderr.write(
    `[argue] warning: reasoning='${reasoning}' configured for cliType '${cliType}', ` +
      "but this adapter does not have a verified reasoning flag yet. Ignoring for now. " +
      "If this provider supports reasoning, please open an issue: https://github.com/onevcat/argue/issues\n"
  );
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
