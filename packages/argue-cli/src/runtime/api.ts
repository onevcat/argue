import { generateText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ApiProviderConfig } from "../config.js";
import { buildTaskPrompt } from "./prompt.js";
import { normalizeTaskOutputFromText } from "./task-output.js";
import type { ProviderTaskRunner } from "./types.js";

export function createApiRunner(provider: ApiProviderConfig): ProviderTaskRunner {
  const modelFactory = createModelFactory(provider);

  return {
    async runTask({ task, agent, abortSignal }) {
      const result = await generateText({
        model: modelFactory(agent.providerModel),
        prompt: buildTaskPrompt({ task, agent, includeJsonSchema: true }),
        system: agent.systemPrompt,
        temperature: agent.temperature ?? agent.modelConfig.temperature,
        maxOutputTokens: agent.modelConfig.maxOutputTokens,
        abortSignal
      });

      return normalizeTaskOutputFromText(task, result.text);
    }
  };
}

function createModelFactory(provider: ApiProviderConfig): (modelId: string) => LanguageModel {
  if (provider.protocol === "openai-compatible") {
    const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
    const openai = createOpenAICompatible({
      name: "argue-openai-compatible",
      baseURL: provider.baseUrl ?? "https://api.openai.com/v1",
      apiKey,
      headers: provider.headers,
      supportsStructuredOutputs: true
    });
    return (modelId: string) => openai.languageModel(modelId);
  }

  const apiKey = provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined;
  const anthropic = createAnthropic({
    baseURL: provider.baseUrl,
    apiKey,
    headers: provider.headers,
    name: "argue-anthropic-compatible"
  });
  return (modelId: string) => anthropic.languageModel(modelId);
}
