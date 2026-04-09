import type { ArgueEvent } from "argue";
import {
  createExampleConfigPath,
  loadCliConfig,
  type ResolveConfigPathOptions
} from "./config.js";
import { executeHeadlessRun } from "./headless-run.js";
import { loadRunInput } from "./run-input.js";
import { resolveRunPlan } from "./run-plan.js";
export type { CliSdkProviderAdapter, CreateCliSdkProviderAdapter, ProviderTaskRunnerArgs } from "./runtime/types.js";

export type CliRunOptions = {
  configPath?: string;
  inputPath?: string;
  agents?: string[];
  requestId?: string;
  topic?: string;
  objective?: string;
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
};

export type CliResult = {
  ok: boolean;
  code: number;
};

export type CliRuntime = {
  isTTY: boolean;
};

export async function runCli(
  argv: string[],
  io: Pick<typeof console, "log" | "error"> = console,
  runtime: CliRuntime = { isTTY: Boolean(process.stdout.isTTY) }
): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (!command) {
    return enterDefaultMode(io, runtime);
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(io);
    return { ok: true, code: 0 };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    io.log("argue-cli v0.1.0");
    return { ok: true, code: 0 };
  }

  if (command === "tui") {
    return enterTuiMode(io, runtime);
  }

  if (command === "run" || command === "exec") {
    return runHeadless(rest, io);
  }

  io.error(`Unknown command: ${command}`);
  printHelp(io);
  return { ok: false, code: 1 };
}

async function runHeadless(args: string[], io: Pick<typeof console, "log" | "error">): Promise<CliResult> {
  const options = parseRunOptions(args);
  if (!options.ok) {
    io.error(options.error);
    return { ok: false, code: 1 };
  }

  let loadedConfig;
  try {
    loadedConfig = await loadCliConfig({ explicitPath: options.value.configPath } satisfies ResolveConfigPathOptions);
  } catch (error) {
    io.error(String(error));
    return { ok: false, code: 1 };
  }

  let runInput;
  try {
    runInput = await loadRunInput(options.value.inputPath, loadedConfig);
  } catch (error) {
    io.error(String(error));
    return { ok: false, code: 1 };
  }

  let plan;
  try {
    plan = resolveRunPlan({
      loadedConfig,
      runInput,
      overrides: options.value
    });
  } catch (error) {
    io.error(String(error));
    return { ok: false, code: 1 };
  }

  io.log("[argue-cli] run plan resolved");
  io.log(`- config: ${loadedConfig.configPath}`);
  io.log(`- input: ${options.value.inputPath ?? "(none)"}`);
  io.log(`- requestId: ${plan.requestId}`);
  io.log(`- topic: ${plan.topic}`);
  io.log(`- objective: ${plan.objective}`);
  io.log(`- agents: ${plan.participantIds.join(", ")}`);
  io.log(`- rounds: ${plan.startInput.roundPolicy.minRounds}..${plan.startInput.roundPolicy.maxRounds}`);
  io.log(`- composer: ${plan.startInput.reportPolicy.composer}`);
  io.log(`- jsonl: ${plan.jsonlPath}`);
  io.log(`- result: ${plan.resultPath}`);
  io.log(`- summary: ${plan.summaryPath}`);

  const onProgressEvent = createHeadlessProgressRenderer(io);

  try {
    const execution = await executeHeadlessRun({
      loadedConfig,
      plan,
      onEvent: onProgressEvent
    });

    io.log("[argue-cli] run completed");
    io.log(`- status: ${execution.result.status}`);
    io.log(`- representative: ${execution.result.representative.participantId}`);
    io.log(`- jsonl: ${execution.jsonlPath}`);
    io.log(`- result: ${execution.resultPath}`);
    io.log(`- summary: ${execution.summaryPath}`);
    return { ok: true, code: 0 };
  } catch (error) {
    io.error(String(error));
    return { ok: false, code: 1 };
  }
}

function enterDefaultMode(io: Pick<typeof console, "log" | "error">, runtime: CliRuntime): CliResult {
  if (!runtime.isTTY) {
    io.error("No TTY detected. Use 'argue run ...' or 'argue exec ...' for headless mode.");
    return { ok: false, code: 1 };
  }

  io.log("[argue-cli] entering TUI mode (skeleton)");
  io.log("- interactive agent selection: TODO");
  io.log("- interactive topic/objective input: TODO");
  io.log("- switch to headless anytime with: argue run/exec");
  return { ok: true, code: 0 };
}

function enterTuiMode(io: Pick<typeof console, "log" | "error">, runtime: CliRuntime): CliResult {
  if (!runtime.isTTY) {
    io.error("Command 'argue tui' requires a TTY. Use 'argue run ...' or 'argue exec ...' in non-interactive environments.");
    return { ok: false, code: 1 };
  }

  io.log("[argue-cli] entering TUI mode (skeleton)");
  io.log("- interactive agent selection: TODO");
  io.log("- interactive topic/objective input: TODO");
  return { ok: true, code: 0 };
}

function parseRunOptions(args: string[]):
  | { ok: true; value: CliRunOptions }
  | { ok: false; error: string } {
  const out: CliRunOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--config" || arg === "-c") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--config requires a path" };
      out.configPath = value;
      i += 1;
      continue;
    }

    if (arg === "--input" || arg === "-i") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--input requires a path" };
      out.inputPath = value;
      i += 1;
      continue;
    }

    if (arg === "--agents") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--agents requires comma-separated ids" };
      out.agents = parseAgentList(value);
      i += 1;
      continue;
    }

    if (arg === "--request-id") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--request-id requires a value" };
      out.requestId = value;
      i += 1;
      continue;
    }

    if (arg === "--topic") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--topic requires a value" };
      out.topic = value;
      i += 1;
      continue;
    }

    if (arg === "--objective") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--objective requires a value" };
      out.objective = value;
      i += 1;
      continue;
    }

    if (arg === "--jsonl") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--jsonl requires a path" };
      out.jsonlPath = value;
      i += 1;
      continue;
    }

    if (arg === "--result") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--result requires a path" };
      out.resultPath = value;
      i += 1;
      continue;
    }

    if (arg === "--summary") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--summary requires a path" };
      out.summaryPath = value;
      i += 1;
      continue;
    }

    if (arg === "--min-rounds") {
      const value = parseIntArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.minRounds = value;
      i += 1;
      continue;
    }

    if (arg === "--max-rounds") {
      const value = parseIntArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.maxRounds = value;
      i += 1;
      continue;
    }

    if (arg === "--per-task-timeout-ms") {
      const value = parseIntArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.perTaskTimeoutMs = value;
      i += 1;
      continue;
    }

    if (arg === "--per-round-timeout-ms") {
      const value = parseIntArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.perRoundTimeoutMs = value;
      i += 1;
      continue;
    }

    if (arg === "--global-deadline-ms") {
      const value = parseIntArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.globalDeadlineMs = value;
      i += 1;
      continue;
    }

    if (arg === "--threshold") {
      const value = parseFloatArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.consensusThreshold = value;
      i += 1;
      continue;
    }

    if (arg === "--composer") {
      const value = args[i + 1];
      if (!value || (value !== "builtin" && value !== "representative")) {
        return { ok: false, error: "--composer must be builtin or representative" };
      }
      out.composer = value;
      i += 1;
      continue;
    }

    if (arg === "--representative-id") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--representative-id requires a value" };
      out.representativeId = value;
      i += 1;
      continue;
    }

    if (arg === "--trace") {
      out.includeDeliberationTrace = true;
      continue;
    }

    if (arg === "--trace-level") {
      const value = args[i + 1];
      if (!value || (value !== "compact" && value !== "full")) {
        return { ok: false, error: "--trace-level must be compact or full" };
      }
      out.traceLevel = value;
      i += 1;
      continue;
    }

    if (arg === "--language") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--language requires a value" };
      out.language = value;
      i += 1;
      continue;
    }

    if (arg === "--token-budget") {
      const value = parseIntArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.tokenBudgetHint = value;
      i += 1;
      continue;
    }

    return { ok: false, error: `Unknown option for run: ${arg}` };
  }

  return { ok: true, value: out };
}

function parseAgentList(raw: string): string[] {
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseIntArg(flag: string, raw: string | undefined): number | string {
  if (!raw) return `${flag} requires a value`;
  if (!/^[+-]?\d+$/.test(raw)) return `${flag} must be an integer`;

  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return `${flag} must be a safe integer`;
  return n;
}

function parseFloatArg(flag: string, raw: string | undefined): number | string {
  if (!raw) return `${flag} requires a value`;
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
    return `${flag} must be a number`;
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return `${flag} must be a number`;
  return n;
}

function createHeadlessProgressRenderer(io: Pick<typeof console, "log">): (event: ArgueEvent) => void {
  return (event) => {
    const payload = event.payload ?? {};
    const phase = readString(payload.phase);
    const round = readNumber(payload.round);
    const roundTag = formatRoundTag(phase, round);

    if (event.type === "RoundDispatched") {
      const participants = readStringArray(payload.participants);
      io.log(`[argue-cli] round ${roundTag} dispatched -> ${participants.join(", ")}`);
      return;
    }

    if (event.type === "ParticipantResponded") {
      const participantId = readString(payload.participantId) ?? "unknown";
      const extractedClaims = readNumber(payload.extractedClaims) ?? 0;
      const judgements = readNumber(payload.judgements) ?? 0;
      const claimVotes = readNumber(payload.claimVotes) ?? 0;
      io.log(
        `[argue-cli] ${roundTag} ${participantId} responded (claims+${extractedClaims}, judgements=${judgements}, votes=${claimVotes})`
      );

      const summary = readString(payload.summary);
      if (summary) {
        io.log(`  summary: ${singleLine(summary, 120)}`);
      }
      return;
    }

    if (event.type === "ParticipantEliminated") {
      const participantId = readString(payload.participantId) ?? "unknown";
      const reason = readString(payload.reason) ?? "unknown";
      io.log(`[argue-cli] ${roundTag} ${participantId} eliminated (${reason})`);
      return;
    }

    if (event.type === "ClaimsMerged") {
      const source = readString(payload.sourceClaimId) ?? "?";
      const mergedInto = readString(payload.mergedInto) ?? "?";
      io.log(`[argue-cli] ${roundTag} claim merged ${source} -> ${mergedInto}`);
      return;
    }

    if (event.type === "RoundCompleted") {
      const completed = readNumber(payload.completed) ?? 0;
      const timedOut = readNumber(payload.timedOut) ?? 0;
      const failed = readNumber(payload.failed) ?? 0;
      const claimCatalogSize = readNumber(payload.claimCatalogSize) ?? 0;
      const newClaims = readNumber(payload.newClaims) ?? 0;
      const mergeCount = readNumber(payload.mergeCount) ?? 0;
      io.log(
        `[argue-cli] round ${roundTag} completed: done=${completed} timeout=${timedOut} failed=${failed} claims=${claimCatalogSize} (+${newClaims}, ~${mergeCount})`
      );
      return;
    }

    if (event.type === "GlobalDeadlineHit") {
      io.log("[argue-cli] global deadline hit");
      return;
    }

    if (event.type === "EarlyStopTriggered") {
      io.log(`[argue-cli] early stop triggered at ${roundTag}`);
    }
  };
}

function formatRoundTag(phase: string | undefined, round: number | undefined): string {
  if (phase !== undefined && round !== undefined) return `${phase}#${round}`;
  if (phase !== undefined) return phase;
  if (round !== undefined) return `#${round}`;
  return "n/a";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function singleLine(value: string, maxLen: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function printHelp(io: Pick<typeof console, "log">): void {
  io.log("argue-cli");
  io.log("");
  io.log("Usage:");
  io.log("  argue                           # TUI mode (when TTY is available)");
  io.log("  argue tui                       # force TUI mode");
  io.log("  argue run|exec [options]        # headless mode");
  io.log("  argue help");
  io.log("  argue version");
  io.log("");
  io.log("Headless options:");
  io.log("  --config <path>                 config JSON path");
  io.log("  --input <path>                  run input JSON path (topic/objective/agents etc.)");
  io.log("  --agents a,b,c                  override selected agents");
  io.log("  --topic <text> --objective <text>");
  io.log("  --request-id <id>");
  io.log("  --jsonl <path> --result <path> --summary <path>");
  io.log("  --min-rounds <n> --max-rounds <n> --threshold <0..1>");
  io.log("  --composer builtin|representative --representative-id <id>");
  io.log("  --trace --trace-level compact|full");
  io.log("  --language <lang> --token-budget <n>");
  io.log("");
  io.log("Config lookup order (when --config is omitted):");
  io.log("  1) ./argue.config.json");
  io.log(`  2) ${createExampleConfigPath()}`);
  io.log("");
  io.log("Precedence:");
  io.log("  CLI flags > input JSON (--input) > config defaults");
}
