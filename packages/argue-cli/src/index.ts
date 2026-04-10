import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  AgentSchema,
  CliConfigSchema,
  createExampleConfigPath,
  loadCliConfig,
  loadRawCliConfig,
  ProviderSchema,
  resolveConfigPath,
  type ResolveConfigPathOptions
} from "./config.js";
import { executeHeadlessRun } from "./headless-run.js";
import { createOutputFormatter } from "./output.js";
import { loadRunInput } from "./run-input.js";
import { resolveRunPlan } from "./run-plan.js";
import { VENDOR_PRESETS, getVendorNames } from "./vendors.js";
export type { CliSdkProviderAdapter, CreateCliSdkProviderAdapter, ProviderTaskRunnerArgs } from "./runtime/types.js";

export type CliRunOptions = {
  configPath?: string;
  inputPath?: string;
  agents?: string[];
  requestId?: string;
  task?: string;
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
  verbose?: boolean;
  noColor?: boolean;
};

type ConfigAddProviderOptions = {
  configPath?: string;
  id: string;
  type: "api" | "cli" | "sdk" | "mock";
  modelId: string;
  providerModel?: string;
  vendor?: string;
  protocol?: "openai-compatible" | "anthropic-compatible";
  baseUrl?: string;
  apiKeyEnv?: string;
  cliType?: "codex" | "claude" | "copilot" | "gemini" | "pi" | "opencode" | "generic";
  command?: string;
  args?: string[];
  adapter?: string;
  exportName?: string;
};

type ConfigAddAgentOptions = {
  configPath?: string;
  id: string;
  provider: string;
  model: string;
  role?: string;
  systemPrompt?: string;
  timeoutMs?: number;
  temperature?: number;
};

export type CliResult = {
  ok: boolean;
  code: number;
};

export async function runCli(
  argv: string[],
  io: Pick<typeof console, "log" | "error"> = console
): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (!command) {
    printHelp(io);
    return { ok: true, code: 0 };
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp(io);
    return { ok: true, code: 0 };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    io.log("argue-cli v0.1.0");
    return { ok: true, code: 0 };
  }

  if (command === "run" || command === "exec") {
    return runHeadless(rest, io);
  }

  if (command === "config") {
    return runConfigCommand(rest, io);
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

  const out = createOutputFormatter(io, {
    verbose: options.value.verbose,
    noColor: options.value.noColor,
    isTTY: process.stdout.isTTY
  });

  out.planResolved({
    configPath: loadedConfig.configPath,
    requestId: plan.requestId,
    task: plan.task,
    agents: plan.participantIds,
    rounds: `${plan.startInput.roundPolicy.minRounds}..${plan.startInput.roundPolicy.maxRounds}`,
    composer: plan.startInput.reportPolicy.composer,
    jsonlPath: plan.jsonlPath
  });

  try {
    const execution = await executeHeadlessRun({
      loadedConfig,
      plan,
      onEvent: out.createEventHandler()
    });

    if (!execution.ok) {
      out.runFailed(execution.error, execution.errorPath);
      return { ok: false, code: 1 };
    }

    out.runCompleted(execution.result, {
      resultPath: execution.resultPath,
      summaryPath: execution.summaryPath
    });
    return { ok: true, code: 0 };
  } catch (error) {
    io.error(String(error));
    return { ok: false, code: 1 };
  }
}

async function runConfigCommand(args: string[], io: Pick<typeof console, "log" | "error">): Promise<CliResult> {
  const [subcommand, ...rest] = args;

  if (subcommand === "init") {
    const configPath = parseConfigInitPath(rest);
    if (!configPath.ok) {
      io.error(configPath.error);
      return { ok: false, code: 1 };
    }

    try {
      const target = configPath.value;

      if (await fileExists(target)) {
        try {
          const loaded = await loadRawCliConfig(target);
          const strict = CliConfigSchema.safeParse(loaded.config);

          if (strict.success) {
            io.log(`[argue-cli] config already initialized: ${target}`);
            return { ok: true, code: 0 };
          }

          io.error(`[argue-cli] existing config is invalid and was not overwritten: ${target}`);
          for (const issue of strict.error.issues.slice(0, 5)) {
            const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
            io.error(`- ${path}: ${issue.message}`);
          }
          io.error("Fix the config or move/delete it, then run 'argue config init' again.");
          return { ok: false, code: 1 };
        } catch (error) {
          io.error(`[argue-cli] existing config is invalid and was not overwritten: ${target}`);
          io.error(`- ${String(error)}`);
          io.error("Fix the config or move/delete it, then run 'argue config init' again.");
          return { ok: false, code: 1 };
        }
      }

      await writeConfigFile(target, {
        schemaVersion: 1,
        providers: {},
        agents: []
      });

      io.log(`[argue-cli] config initialized: ${target}`);
      return { ok: true, code: 0 };
    } catch (error) {
      io.error(String(error));
      return { ok: false, code: 1 };
    }
  }

  if (subcommand === "add-provider") {
    const options = parseConfigAddProviderOptions(rest);
    if (!options.ok) {
      io.error(options.error);
      return { ok: false, code: 1 };
    }

    try {
      const configPath = await resolveConfigPath({ explicitPath: options.value.configPath });
      const loaded = await loadRawCliConfig(configPath);

      if (loaded.config.providers[options.value.id]) {
        throw new Error(`Provider id already exists: ${options.value.id}`);
      }

      const provider = buildProviderFromOptions(options.value);
      loaded.config.providers[options.value.id] = provider;

      await writeConfigFile(configPath, loaded.config);

      io.log(`[argue-cli] provider added: ${options.value.id}`);
      io.log(`- config: ${configPath}`);
      io.log(`- type: ${options.value.type}`);
      io.log(`- model: ${options.value.modelId}`);
      return { ok: true, code: 0 };
    } catch (error) {
      io.error(String(error));
      return { ok: false, code: 1 };
    }
  }

  if (subcommand === "add-agent") {
    const options = parseConfigAddAgentOptions(rest);
    if (!options.ok) {
      io.error(options.error);
      return { ok: false, code: 1 };
    }

    try {
      const configPath = await resolveConfigPath({ explicitPath: options.value.configPath });
      const loaded = await loadRawCliConfig(configPath);

      if (loaded.config.agents.some((agent) => agent.id === options.value.id)) {
        throw new Error(`Agent id already exists: ${options.value.id}`);
      }

      const providerRaw = loaded.config.providers[options.value.provider];
      if (!providerRaw) {
        throw new Error(`Unknown provider: ${options.value.provider}`);
      }
      const provider = ProviderSchema.parse(providerRaw);
      if (!provider.models[options.value.model]) {
        throw new Error(`Unknown model '${options.value.model}' for provider '${options.value.provider}'`);
      }

      const agent = AgentSchema.parse({
        id: options.value.id,
        provider: options.value.provider,
        model: options.value.model,
        ...(options.value.role ? { role: options.value.role } : {}),
        ...(options.value.systemPrompt ? { systemPrompt: options.value.systemPrompt } : {}),
        ...(typeof options.value.timeoutMs === "number" ? { timeoutMs: options.value.timeoutMs } : {}),
        ...(typeof options.value.temperature === "number" ? { temperature: options.value.temperature } : {})
      });

      loaded.config.agents.push(agent);

      await writeConfigFile(configPath, loaded.config);

      io.log(`[argue-cli] agent added: ${options.value.id}`);
      io.log(`- config: ${configPath}`);
      io.log(`- provider/model: ${options.value.provider}/${options.value.model}`);
      return { ok: true, code: 0 };
    } catch (error) {
      io.error(String(error));
      return { ok: false, code: 1 };
    }
  }

  io.error("Unknown config subcommand. Use 'argue config init', 'argue config add-provider ...', or 'argue config add-agent ...'.");
  return { ok: false, code: 1 };
}

function parseConfigInitPath(args: string[]): { ok: true; value: string } | { ok: false; error: string } {
  let explicitPath: string | undefined;
  let useLocal = false;
  let useGlobal = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--config requires a path" };
      explicitPath = value;
      i += 1;
      continue;
    }

    if (arg === "--local" || arg === "--project") {
      useLocal = true;
      continue;
    }

    if (arg === "--global") {
      useGlobal = true;
      continue;
    }

    return { ok: false, error: `Unknown option for config init: ${arg}` };
  }

  if (useLocal && useGlobal) {
    return { ok: false, error: "Choose either --local/--project or --global." };
  }

  if (explicitPath && (useLocal || useGlobal)) {
    return { ok: false, error: "--config cannot be combined with --local/--project/--global." };
  }

  if (explicitPath) {
    return { ok: true, value: resolve(explicitPath) };
  }

  if (useLocal) {
    return { ok: true, value: resolve("argue.config.json") };
  }

  return { ok: true, value: createExampleConfigPath() };
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

    if (arg === "--task") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--task requires a value" };
      out.task = value;
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

    if (arg === "--verbose" || arg === "-v") {
      out.verbose = true;
      continue;
    }

    if (arg === "--no-color") {
      out.noColor = true;
      continue;
    }

    return { ok: false, error: `Unknown option for run: ${arg}` };
  }

  return { ok: true, value: out };
}

function parseConfigAddProviderOptions(args: string[]):
  | { ok: true; value: ConfigAddProviderOptions }
  | { ok: false; error: string } {
  const out: Partial<ConfigAddProviderOptions> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--config" || arg === "-c") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--config requires a path" };
      out.configPath = value;
      i += 1;
      continue;
    }

    if (arg === "--id") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--id requires a value" };
      out.id = value;
      i += 1;
      continue;
    }

    if (arg === "--type") {
      const value = args[i + 1];
      if (!value || (value !== "api" && value !== "cli" && value !== "sdk" && value !== "mock")) {
        return { ok: false, error: "--type must be api, cli, sdk, or mock" };
      }
      out.type = value;
      i += 1;
      continue;
    }

    if (arg === "--model-id") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--model-id requires a value" };
      out.modelId = value;
      i += 1;
      continue;
    }

    if (arg === "--provider-model") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--provider-model requires a value" };
      out.providerModel = value;
      i += 1;
      continue;
    }

    if (arg === "--protocol") {
      const value = args[i + 1];
      if (!value || (value !== "openai-compatible" && value !== "anthropic-compatible")) {
        return { ok: false, error: "--protocol must be openai-compatible or anthropic-compatible" };
      }
      out.protocol = value;
      i += 1;
      continue;
    }

    if (arg === "--base-url") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--base-url requires a value" };
      out.baseUrl = value;
      i += 1;
      continue;
    }

    if (arg === "--api-key-env") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--api-key-env requires a value" };
      out.apiKeyEnv = value;
      i += 1;
      continue;
    }

    if (arg === "--vendor") {
      const value = args[i + 1];
      const names = getVendorNames();
      if (!value || !names.includes(value)) {
        return { ok: false, error: `--vendor must be one of: ${names.join(", ")}` };
      }
      out.vendor = value;
      i += 1;
      continue;
    }

    if (arg === "--cli-type") {
      const value = args[i + 1];
      const validCliTypes = ["codex", "claude", "copilot", "gemini", "pi", "opencode", "generic"] as const;
      if (!value || !validCliTypes.includes(value as typeof validCliTypes[number])) {
        return { ok: false, error: `--cli-type must be one of: ${validCliTypes.join(", ")}` };
      }
      out.cliType = value as typeof validCliTypes[number];
      i += 1;
      continue;
    }

    if (arg === "--command") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--command requires a value" };
      out.command = value;
      i += 1;
      continue;
    }

    if (arg === "--args") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--args requires a value" };
      out.args = parseCsvList(value);
      i += 1;
      continue;
    }

    if (arg === "--adapter") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--adapter requires a value" };
      out.adapter = value;
      i += 1;
      continue;
    }

    if (arg === "--export-name") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--export-name requires a value" };
      out.exportName = value;
      i += 1;
      continue;
    }

    return { ok: false, error: `Unknown option for config add-provider: ${arg}` };
  }

  if (!out.id) return { ok: false, error: "Missing provider id. Use --id <provider-id>." };
  if (!out.type) return { ok: false, error: "Missing provider type. Use --type <api|cli|sdk|mock>." };
  if (!out.modelId) return { ok: false, error: "Missing model id. Use --model-id <model-id>." };

  if (out.vendor && out.type !== "api") {
    return { ok: false, error: "--vendor is only valid for --type api." };
  }

  if (out.type === "api") {
    if (out.vendor) {
      const preset = VENDOR_PRESETS[out.vendor]!;
      if (!out.protocol) out.protocol = preset.protocol;
      if (!out.baseUrl && preset.baseUrl) out.baseUrl = preset.baseUrl;
      if (!out.apiKeyEnv && preset.apiKeyEnv) out.apiKeyEnv = preset.apiKeyEnv;
    }
    if (!out.protocol) {
      return { ok: false, error: "API provider requires --protocol or --vendor." };
    }
  }

  if (out.type === "cli") {
    if (!out.cliType) {
      return { ok: false, error: "CLI provider requires --cli-type <codex|claude|copilot|gemini|pi|opencode|generic>." };
    }
    if (!out.command) {
      return { ok: false, error: "CLI provider requires --command <binary>." };
    }
  }

  if (out.type === "sdk" && !out.adapter) {
    return { ok: false, error: "SDK provider requires --adapter <module-path-or-package>." };
  }

  return { ok: true, value: out as ConfigAddProviderOptions };
}

function parseConfigAddAgentOptions(args: string[]):
  | { ok: true; value: ConfigAddAgentOptions }
  | { ok: false; error: string } {
  const out: Partial<ConfigAddAgentOptions> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--config" || arg === "-c") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--config requires a path" };
      out.configPath = value;
      i += 1;
      continue;
    }

    if (arg === "--id") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--id requires a value" };
      out.id = value;
      i += 1;
      continue;
    }

    if (arg === "--provider") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--provider requires a value" };
      out.provider = value;
      i += 1;
      continue;
    }

    if (arg === "--model") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--model requires a value" };
      out.model = value;
      i += 1;
      continue;
    }

    if (arg === "--role") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--role requires a value" };
      out.role = value;
      i += 1;
      continue;
    }

    if (arg === "--system-prompt") {
      const value = args[i + 1];
      if (!value) return { ok: false, error: "--system-prompt requires a value" };
      out.systemPrompt = value;
      i += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      const value = parseIntArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.timeoutMs = value;
      i += 1;
      continue;
    }

    if (arg === "--temperature") {
      const value = parseFloatArg(arg, args[i + 1]);
      if (typeof value === "string") return { ok: false, error: value };
      out.temperature = value;
      i += 1;
      continue;
    }

    return { ok: false, error: `Unknown option for config add-agent: ${arg}` };
  }

  if (!out.id) return { ok: false, error: "Missing agent id. Use --id <agent-id>." };
  if (!out.provider) return { ok: false, error: "Missing provider id. Use --provider <provider-id>." };
  if (!out.model) return { ok: false, error: "Missing model id. Use --model <model-id>." };

  return { ok: true, value: out as ConfigAddAgentOptions };
}

function buildProviderFromOptions(options: ConfigAddProviderOptions): unknown {
  const modelConfig: Record<string, unknown> = {};
  modelConfig[options.modelId] = options.providerModel
    ? { providerModel: options.providerModel }
    : {};

  if (options.type === "api") {
    return ProviderSchema.parse({
      type: "api",
      protocol: options.protocol,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}),
      models: modelConfig
    });
  }

  if (options.type === "cli") {
    return ProviderSchema.parse({
      type: "cli",
      cliType: options.cliType,
      command: options.command,
      args: options.args ?? [],
      models: modelConfig
    });
  }

  if (options.type === "sdk") {
    return ProviderSchema.parse({
      type: "sdk",
      adapter: options.adapter,
      ...(options.exportName ? { exportName: options.exportName } : {}),
      models: modelConfig
    });
  }

  return ProviderSchema.parse({
    type: "mock",
    models: modelConfig
  });
}


async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeConfigFile(path: string, nextConfig: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
}

function parseCsvList(raw: string): string[] {
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseAgentList(raw: string): string[] {
  return parseCsvList(raw);
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

function printHelp(io: Pick<typeof console, "log">): void {
  io.log("argue-cli");
  io.log("");
  io.log("Usage:");
  io.log("  argue run|exec [options]        # run a debate session");
  io.log("  argue config init                # create empty config file");
  io.log("  argue config add-provider ...    # append provider to config");
  io.log("  argue config add-agent ...       # append agent to config");
  io.log("  argue help");
  io.log("  argue version");
  io.log("");
  io.log("Headless options:");
  io.log("  --config <path>                 config JSON path");
  io.log("  --input <path>                  run input JSON path (task/agents etc.)");
  io.log("  --agents a,b,c                  override selected agents");
  io.log("  --task <text>");
  io.log("  --request-id <id>");
  io.log("  --jsonl <path> --result <path> --summary <path>");
  io.log("  --min-rounds <n> --max-rounds <n> --threshold <0..1>");
  io.log("  --composer builtin|representative --representative-id <id>");
  io.log("  --trace --trace-level compact|full");
  io.log("  --language <lang> --token-budget <n>");
  io.log("  --verbose|-v                        # detailed output with agent opinions");
  io.log("  --no-color                          # disable colored output");
  io.log("");
  io.log("Config commands:");
  io.log("  argue config init [-c <path>] [--local|--project|--global]");
  io.log("  argue config add-provider --id <provider-id> --type <api|cli|sdk|mock> --model-id <model-id> [type options]");
  io.log(`    api options: --vendor <${getVendorNames().join("|")}> | --protocol <openai-compatible|anthropic-compatible> [--base-url <url>] [--api-key-env <ENV_VAR>]`);
  io.log("    cli options: --cli-type <codex|claude|copilot|gemini|pi|opencode|generic> --command <binary> [--args a,b,c (extra)]");
  io.log("    sdk options: --adapter <module> [--export-name <name>]");
  io.log("  argue config add-agent --id <agent-id> --provider <provider-id> --model <model-id> [--role <text>] [--system-prompt <text>]");
  io.log("                         [--timeout-ms <n>] [--temperature <0..2>]");
  io.log("");
  io.log("Config init default path:");
  io.log(`  - ${createExampleConfigPath()} (use --local/--project for ./argue.config.json)`);
  io.log("");
  io.log("Config lookup order (when --config is omitted):");
  io.log("  1) ./argue.config.json");
  io.log(`  2) ${createExampleConfigPath()}`);
  io.log("");
  io.log("Precedence:");
  io.log("  CLI flags > input JSON (--input) > config defaults");
}
