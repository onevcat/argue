import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

export const ProviderModelSchema = z
  .object({
    providerModel: z.string().min(1).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional()
  })
  .strict();

const ProviderModelsSchema = z.record(ProviderModelSchema).refine((models) => Object.keys(models).length > 0, {
  message: "provider.models must contain at least one model"
});

export const ApiProviderSchema = z
  .object({
    type: z.literal("api"),
    protocol: z.enum(["openai-compatible", "anthropic-compatible"]),
    baseUrl: z.string().url().optional(),
    apiKeyEnv: z.string().min(1).optional(),
    headers: z.record(z.string()).optional(),
    models: ProviderModelsSchema
  })
  .strict();

export const CliProviderSchema = z
  .object({
    type: z.literal("cli"),
    cliType: z.enum(["codex", "claude", "copilot", "gemini", "pi", "opencode", "droid", "amp", "generic"]),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
    models: ProviderModelsSchema
  })
  .strict();

export const SdkProviderSchema = z
  .object({
    type: z.literal("sdk"),
    adapter: z.string().min(1),
    exportName: z.string().min(1).optional(),
    env: z.record(z.string()).optional(),
    options: z.record(z.unknown()).optional(),
    models: ProviderModelsSchema
  })
  .strict();

export const MockProviderActionSchema = z
  .object({
    behavior: z.enum(["deterministic", "timeout", "error", "malformed"]).default("deterministic"),
    delayMs: z.number().int().nonnegative().optional(),
    error: z.string().min(1).optional()
  })
  .strict();

export const MockParticipantScenarioSchema = z
  .object({
    initial: MockProviderActionSchema.optional(),
    debate: MockProviderActionSchema.optional(),
    final_vote: MockProviderActionSchema.optional(),
    report: MockProviderActionSchema.optional(),
    action: MockProviderActionSchema.optional()
  })
  .strict();

export const MockProviderSchema = z
  .object({
    type: z.literal("mock"),
    seed: z.string().min(1).optional(),
    defaultBehavior: MockProviderActionSchema.optional(),
    participants: z.record(MockParticipantScenarioSchema).optional(),
    models: ProviderModelsSchema
  })
  .strict();

export const ProviderSchema = z.discriminatedUnion("type", [
  ApiProviderSchema,
  CliProviderSchema,
  SdkProviderSchema,
  MockProviderSchema
]);

export const AgentSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    role: z.string().min(1).optional(),
    systemPrompt: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional()
  })
  .strict();

export const DefaultsSchema = z
  .object({
    defaultAgents: z.array(z.string().min(1)).min(2).optional(),
    language: z.string().min(1).optional(),
    tokenBudgetHint: z.number().int().positive().optional(),
    minRounds: z.number().int().min(0).optional(),
    maxRounds: z.number().int().min(1).optional(),
    perTaskTimeoutMs: z.number().int().positive().optional(),
    perRoundTimeoutMs: z.number().int().positive().optional(),
    globalDeadlineMs: z.number().int().positive().optional(),
    consensusThreshold: z.number().min(0).max(1).optional(),
    composer: z.enum(["builtin", "representative"]).optional(),
    representativeId: z.string().min(1).optional(),
    includeDeliberationTrace: z.boolean().optional(),
    traceLevel: z.enum(["compact", "full"]).optional()
  })
  .strict();

export const OutputSchema = z
  .object({
    jsonlPath: z.string().min(1).optional(),
    resultPath: z.string().min(1).optional(),
    summaryPath: z.string().min(1).optional()
  })
  .strict();

export const DEFAULT_VIEWER_URL = "https://argue.onev.cat/";

function isSecureOrLoopbackUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:") {
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  }
  return false;
}

export const ViewerConfigSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => isSecureOrLoopbackUrl(value), {
        message: "viewer.url must use https:// (http:// is allowed only for localhost/127.0.0.1)"
      })
  })
  .strict();

const CliConfigSchemaBase = z
  .object({
    schemaVersion: z.literal(1),
    output: OutputSchema.optional(),
    viewer: ViewerConfigSchema.optional(),
    defaults: DefaultsSchema.optional(),
    providers: z.record(ProviderSchema).refine((providers) => Object.keys(providers).length > 0, {
      message: "config.providers must contain at least one provider"
    }),
    agents: z.array(AgentSchema).min(2)
  })
  .strict();

export const CliConfigSchema = CliConfigSchemaBase.superRefine((config, ctx) => {
  const seen = new Set<string>();

  for (const [index, agent] of config.agents.entries()) {
    if (seen.has(agent.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents", index, "id"],
        message: `duplicate agent id: ${agent.id}`
      });
    }
    seen.add(agent.id);

    const provider = config.providers[agent.provider];
    if (!provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents", index, "provider"],
        message: `unknown provider: ${agent.provider}`
      });
      continue;
    }

    if (!provider.models[agent.model]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["agents", index, "model"],
        message: `unknown model '${agent.model}' for provider '${agent.provider}'`
      });
    }
  }

  const minRounds = config.defaults?.minRounds;
  const maxRounds = config.defaults?.maxRounds;
  if (typeof minRounds === "number" && typeof maxRounds === "number" && maxRounds < minRounds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaults", "maxRounds"],
      message: "defaults.maxRounds must be >= defaults.minRounds"
    });
  }

  for (const [index, agentId] of (config.defaults?.defaultAgents ?? []).entries()) {
    if (!config.agents.some((agent) => agent.id === agentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaults", "defaultAgents", index],
        message: `unknown default agent id: ${agentId}`
      });
    }
  }
});

export type CliConfig = z.infer<typeof CliConfigSchema>;
export type ProviderModelConfig = z.infer<typeof ProviderModelSchema>;
export type ApiProviderConfig = z.infer<typeof ApiProviderSchema>;
export type CliProviderConfig = z.infer<typeof CliProviderSchema>;
export type SdkProviderConfig = z.infer<typeof SdkProviderSchema>;
export type MockProviderConfig = z.infer<typeof MockProviderSchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;
export type CliAgentConfig = z.infer<typeof AgentSchema>;

export type LoadedCliConfig = {
  configPath: string;
  configDir: string;
  config: CliConfig;
};

export type ResolveConfigPathOptions = {
  explicitPath?: string;
  cwd?: string;
  homeDir?: string;
};

export async function resolveConfigPath(options: ResolveConfigPathOptions = {}): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? homedir();

  if (options.explicitPath) {
    const explicit = toAbsolute(options.explicitPath, cwd);
    await ensureFileExists(explicit, `Config file not found: ${explicit}`);
    return explicit;
  }

  const projectPath = resolve(cwd, "argue.config.json");
  if (await fileExists(projectPath)) {
    return projectPath;
  }

  const globalPath = resolve(homeDir, ".config", "argue", "config.json");
  if (await fileExists(globalPath)) {
    return globalPath;
  }

  throw new Error(
    [
      "Cannot find config file.",
      "Tried:",
      `- ${projectPath}`,
      `- ${globalPath}`,
      "Use --config <path> to specify a file."
    ].join("\n")
  );
}

export async function loadCliConfig(options: ResolveConfigPathOptions = {}): Promise<LoadedCliConfig> {
  const configPath = await resolveConfigPath(options);
  const json = await readJsonFile(configPath);
  const parsed = CliConfigSchema.parse(json);

  return {
    configPath,
    configDir: dirname(configPath),
    config: parsed
  };
}

export type RawCliConfig = {
  schemaVersion: number;
  output?: unknown;
  defaults?: unknown;
  providers: Record<string, unknown>;
  agents: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type LoadedRawCliConfig = {
  configPath: string;
  configDir: string;
  config: RawCliConfig;
};

const RawCliConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    providers: z.record(z.unknown()).default({}),
    agents: z.array(z.record(z.unknown())).default([])
  })
  .passthrough();

export async function loadRawCliConfig(configPath: string): Promise<LoadedRawCliConfig> {
  const json = await readJsonFile(configPath);
  const parsed = RawCliConfigSchema.parse(json);

  return {
    configPath,
    configDir: dirname(configPath),
    config: parsed as RawCliConfig
  };
}

export async function readJsonFile(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in file: ${path} (${String(error)})`);
  }
}

export function resolvePath(rawPath: string, baseDir: string): string {
  if (isAbsolute(rawPath)) return rawPath;
  return resolve(baseDir, rawPath);
}

export function resolveOutputPath(rawPath: string, baseDir: string, requestId: string): string {
  const withRequestId = rawPath.replaceAll("{requestId}", requestId);
  return resolvePath(withRequestId, baseDir);
}

function toAbsolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureFileExists(path: string, message: string): Promise<void> {
  if (await fileExists(path)) return;
  throw new Error(message);
}

export function createExampleConfigPath(homeDir: string = homedir()): string {
  return join(homeDir, ".config", "argue", "config.json");
}
