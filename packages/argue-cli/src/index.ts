import {
  createExampleConfigPath,
  loadCliConfig,
  type ResolveConfigPathOptions
} from "./config.js";
import { loadRunInput } from "./run-input.js";
import { resolveRunPlan } from "./run-plan.js";

export type CliRunOptions = {
  configPath?: string;
  inputPath?: string;
  agents?: string[];
  requestId?: string;
  topic?: string;
  objective?: string;
  jsonlPath?: string;
  resultPath?: string;
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

export async function runCli(argv: string[], io: Pick<typeof console, "log" | "error"> = console): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp(io);
    return { ok: true, code: 0 };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    io.log("argue-cli v0.1.0");
    return { ok: true, code: 0 };
  }

  if (command === "run") {
    const options = parseRunOptions(rest);
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
    io.log("- runtime adapters: TODO (claude/codex/mock)");
    io.log("- execution: TODO (map selected agents -> delegate -> ArgueEngine.start)");

    return { ok: true, code: 0 };
  }

  io.error(`Unknown command: ${command}`);
  printHelp(io);
  return { ok: false, code: 1 };
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
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return `${flag} must be an integer`;
  return n;
}

function parseFloatArg(flag: string, raw: string | undefined): number | string {
  if (!raw) return `${flag} requires a value`;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return `${flag} must be a number`;
  return n;
}

function printHelp(io: Pick<typeof console, "log">): void {
  io.log("argue-cli");
  io.log("");
  io.log("Usage:");
  io.log("  argue run [--config <path>] [--input <path>] [--agents a,b,c] [--topic <text>] [--objective <text>]");
  io.log("            [--request-id <id>] [--jsonl <path>] [--result <path>]");
  io.log("            [--min-rounds <n>] [--max-rounds <n>] [--threshold <0..1>]");
  io.log("            [--composer builtin|representative] [--representative-id <id>]");
  io.log("            [--trace] [--trace-level compact|full] [--language <lang>] [--token-budget <n>]");
  io.log("  argue help");
  io.log("  argue version");
  io.log("");
  io.log("Config lookup order (when --config is omitted):");
  io.log("  1) ./argue.config.json");
  io.log(`  2) ${createExampleConfigPath()}`);
  io.log("");
  io.log("Precedence:");
  io.log("  CLI flags > input JSON (--input) > config defaults");
}
