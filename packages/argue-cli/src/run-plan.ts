import { homedir } from "node:os";
import { join } from "node:path";
import type { CliConfig, LoadedCliConfig } from "./config.js";
import { resolveOutputPath } from "./config.js";
import type { RunInput } from "./run-input.js";
import { newRequestId } from "./request-id.js";

export type RunOverrides = {
  requestId?: string;
  task?: string;
  agents?: string[];
  jsonlPath?: string;
  resultPath?: string;
  summaryPath?: string;
  minRounds?: number;
  maxRounds?: number;
  perTaskTimeoutMs?: number;
  perRoundTimeoutMs?: number;
  globalDeadlineMs?: number;
  consensusThreshold?: number;
  composer?: "builtin" | "representative";
  representativeId?: string;
  includeDeliberationTrace?: boolean;
  traceLevel?: "compact" | "full";
  language?: string;
  tokenBudgetHint?: number;
  action?: string;
  actionAgent?: string;
  noActionFullResult?: boolean;
};

export type ResolvedRunPlan = {
  requestId: string;
  task: string;
  participantIds: string[];
  jsonlPath: string;
  resultPath: string;
  summaryPath: string;
  errorPath: string;
  startInput: {
    requestId: string;
    task: string;
    participants: Array<{ id: string; role?: string }>;
    roundPolicy: { minRounds: number; maxRounds: number };
    waitingPolicy: {
      perTaskTimeoutMs: number;
      perRoundTimeoutMs: number;
      globalDeadlineMs?: number;
    };
    consensusPolicy: { threshold: number };
    reportPolicy: {
      composer: "builtin" | "representative";
      representativeId?: string;
      includeDeliberationTrace: boolean;
      traceLevel: "compact" | "full";
    };
    constraints?: {
      language?: string;
      tokenBudgetHint?: number;
    };
    context?: Record<string, unknown>;
    actionPolicy?: {
      prompt: string;
      actorId?: string;
      includeFullResult?: boolean;
    };
  };
};

/**
 * Returns the default output directory template (with `{requestId}` token intact)
 * for the given loaded config — used by both `resolveRunPlan` and `argue view`'s
 * discovery path so the two stay in lockstep.
 */
export function defaultOutputDirTemplate(loadedConfig: LoadedCliConfig): string {
  const globalConfigDir = join(homedir(), ".config", "argue");
  const isGlobalConfig = loadedConfig.configDir === globalConfigDir;
  return isGlobalConfig ? join(homedir(), ".argue", "output", "{requestId}") : "./out/{requestId}";
}

export function resolveRunPlan(args: {
  loadedConfig: LoadedCliConfig;
  runInput: RunInput;
  overrides: RunOverrides;
}): ResolvedRunPlan {
  const { loadedConfig, runInput, overrides } = args;
  const config = loadedConfig.config;

  const requestId = overrides.requestId ?? runInput.requestId ?? newRequestId();
  const task = (overrides.task ?? runInput.task ?? "").trim();

  if (!task) {
    throw new Error("Missing task. Provide --task or set task in run input JSON.");
  }

  const participantIds = resolveParticipants(config, runInput, overrides);
  const participants = participantIds.map((id) => {
    const agent = config.agents.find((item) => item.id === id);
    if (!agent) {
      throw new Error(`Unknown agent id: ${id}`);
    }
    return {
      id: agent.id,
      role: agent.role
    };
  });

  const minRounds = overrides.minRounds ?? runInput.minRounds ?? config.defaults?.minRounds ?? 2;
  const maxRounds = overrides.maxRounds ?? runInput.maxRounds ?? config.defaults?.maxRounds ?? 3;
  if (maxRounds < minRounds) {
    throw new Error(`maxRounds must be >= minRounds (got ${maxRounds} < ${minRounds})`);
  }

  const perTaskTimeoutMs =
    overrides.perTaskTimeoutMs ?? runInput.perTaskTimeoutMs ?? config.defaults?.perTaskTimeoutMs ?? 10 * 60 * 1_000;
  const perRoundTimeoutMs =
    overrides.perRoundTimeoutMs ?? runInput.perRoundTimeoutMs ?? config.defaults?.perRoundTimeoutMs ?? 20 * 60 * 1_000;
  const globalDeadlineMs = overrides.globalDeadlineMs ?? runInput.globalDeadlineMs ?? config.defaults?.globalDeadlineMs;

  const threshold =
    overrides.consensusThreshold ?? runInput.consensusThreshold ?? config.defaults?.consensusThreshold ?? 1;

  const composer = overrides.composer ?? runInput.composer ?? config.defaults?.composer ?? "representative";
  const representativeId = overrides.representativeId ?? runInput.representativeId ?? config.defaults?.representativeId;
  const includeDeliberationTrace =
    overrides.includeDeliberationTrace ??
    runInput.includeDeliberationTrace ??
    config.defaults?.includeDeliberationTrace ??
    false;
  const traceLevel = overrides.traceLevel ?? runInput.traceLevel ?? config.defaults?.traceLevel ?? "compact";

  const language = overrides.language ?? runInput.language ?? config.defaults?.language;
  const tokenBudgetHint = overrides.tokenBudgetHint ?? runInput.tokenBudgetHint ?? config.defaults?.tokenBudgetHint;

  const actionPrompt = overrides.action ?? runInput.action?.prompt;
  const actionActorId = overrides.actionAgent ?? runInput.action?.actorId;
  const includeFullResult = overrides.noActionFullResult ? false : (runInput.action?.includeFullResult ?? true);
  const actionPolicy = actionPrompt
    ? { prompt: actionPrompt, ...(actionActorId ? { actorId: actionActorId } : {}), includeFullResult }
    : undefined;

  const defaultOutputDir = defaultOutputDirTemplate(loadedConfig);
  const jsonlRaw = overrides.jsonlPath ?? loadedConfig.config.output?.jsonlPath ?? `${defaultOutputDir}/events.jsonl`;
  const resultRaw = overrides.resultPath ?? loadedConfig.config.output?.resultPath ?? `${defaultOutputDir}/result.json`;
  const summaryRaw =
    overrides.summaryPath ?? loadedConfig.config.output?.summaryPath ?? `${defaultOutputDir}/summary.md`;
  const errorRaw = `${defaultOutputDir}/error.json`;

  return {
    requestId,
    task,
    participantIds,
    jsonlPath: resolveOutputPath(jsonlRaw, loadedConfig.configDir, requestId),
    resultPath: resolveOutputPath(resultRaw, loadedConfig.configDir, requestId),
    summaryPath: resolveOutputPath(summaryRaw, loadedConfig.configDir, requestId),
    errorPath: resolveOutputPath(errorRaw, loadedConfig.configDir, requestId),
    startInput: {
      requestId,
      task,
      participants,
      roundPolicy: { minRounds, maxRounds },
      waitingPolicy: {
        perTaskTimeoutMs,
        perRoundTimeoutMs,
        ...(typeof globalDeadlineMs === "number" ? { globalDeadlineMs } : {})
      },
      consensusPolicy: { threshold },
      reportPolicy: {
        composer,
        ...(representativeId ? { representativeId } : {}),
        includeDeliberationTrace,
        traceLevel
      },
      ...(language || typeof tokenBudgetHint === "number"
        ? {
            constraints: {
              ...(language ? { language } : {}),
              ...(typeof tokenBudgetHint === "number" ? { tokenBudgetHint } : {})
            }
          }
        : {}),
      ...(runInput.context ? { context: runInput.context } : {}),
      ...(actionPolicy ? { actionPolicy } : {})
    }
  };
}

function resolveParticipants(config: CliConfig, runInput: RunInput, overrides: RunOverrides): string[] {
  const source =
    overrides.agents ?? runInput.agents ?? config.defaults?.defaultAgents ?? config.agents.map((agent) => agent.id);

  const normalized = dedupe(source);

  if (normalized.length < 2) {
    throw new Error("At least two agents are required for a run.");
  }

  for (const id of normalized) {
    if (!config.agents.some((agent) => agent.id === id)) {
      throw new Error(`Unknown agent id in selection: ${id}`);
    }
  }

  return normalized;
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
