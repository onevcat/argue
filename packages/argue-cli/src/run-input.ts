import { z } from "zod";
import { readJsonFile, resolvePath, type LoadedCliConfig } from "./config.js";

export const RunInputSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    task: z.string().min(1).optional(),
    agents: z.array(z.string().min(1)).min(2).optional(),
    minRounds: z.number().int().min(0).optional(),
    maxRounds: z.number().int().min(1).optional(),
    perTaskTimeoutMs: z.number().int().positive().optional(),
    perRoundTimeoutMs: z.number().int().positive().optional(),
    globalDeadlineMs: z.number().int().positive().optional(),
    consensusThreshold: z.number().min(0).max(1).optional(),
    composer: z.enum(["builtin", "representative"]).optional(),
    representativeId: z.string().min(1).optional(),
    includeDeliberationTrace: z.boolean().optional(),
    traceLevel: z.enum(["compact", "full"]).optional(),
    language: z.string().min(1).optional(),
    tokenBudgetHint: z.number().int().positive().optional(),
    context: z.record(z.unknown()).optional(),
    action: z
      .object({
        prompt: z.string().min(1),
        actorId: z.string().min(1).optional(),
        includeFullResult: z.boolean().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type RunInput = z.infer<typeof RunInputSchema>;

export async function loadRunInput(path: string | undefined, _loadedConfig: LoadedCliConfig): Promise<RunInput> {
  if (!path) return {};
  const absPath = resolvePath(path, process.cwd());
  const json = await readJsonFile(absPath);
  return RunInputSchema.parse(json);
}
