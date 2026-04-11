import { generateText, type ModelMessage, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ApiProviderConfig } from "../config.js";
import { buildTaskPrompt } from "./prompt.js";
import { normalizeTaskOutputFromText } from "./task-output.js";
import type { ProviderTaskRunner } from "./types.js";

export function createApiRunner(
  providerName: string,
  provider: ApiProviderConfig
): ProviderTaskRunner {
  const modelFactory = createModelFactory(providerName, provider);
  const messages: ModelMessage[] = [];

  return {
    async runTask({ task, agent, abortSignal }) {
      const userContent = buildTaskPrompt({ task, agent, includeJsonSchema: true });
      messages.push({ role: "user", content: userContent });

      const result = await generateText({
        model: modelFactory(agent.providerModel),
        system: agent.systemPrompt,
        messages,
        temperature: agent.temperature ?? agent.modelConfig.temperature,
        maxOutputTokens: agent.modelConfig.maxOutputTokens,
        abortSignal
      });

      messages.push({ role: "assistant", content: result.text });

      return normalizeTaskOutputFromText(task, result.text);
    }
  };
}

function createModelFactory(
  providerName: string,
  provider: ApiProviderConfig
): (modelId: string) => LanguageModel {
  const apiKey = resolveApiKey(providerName, provider);

  if (provider.protocol === "openai-compatible") {
    const openai = createOpenAICompatible({
      name: "argue-openai-compatible",
      baseURL: provider.baseUrl ?? "https://api.openai.com/v1",
      apiKey,
      headers: provider.headers,
      supportsStructuredOutputs: true
    });
    return (modelId: string) => openai.languageModel(modelId);
  }

  const anthropic = createAnthropic({
    baseURL: provider.baseUrl,
    apiKey,
    headers: provider.headers,
    name: "argue-anthropic-compatible"
  });
  return (modelId: string) => anthropic.languageModel(modelId);
}

function resolveApiKey(providerName: string, provider: ApiProviderConfig): string | undefined {
  if (!provider.apiKeyEnv) return undefined;

  const apiKey = process.env[provider.apiKeyEnv];
  if (typeof apiKey === "string" && apiKey.trim().length > 0) {
    return apiKey;
  }

  throw new Error(
    `API key environment variable "${provider.apiKeyEnv}" is not set for provider "${providerName}"`
  );
}
