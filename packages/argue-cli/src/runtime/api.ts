import { generateText, type ModelMessage, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ApiProviderConfig } from "../config.js";
import { buildTaskPrompt } from "./prompt.js";
import { normalizeTaskOutputFromText } from "./task-output.js";
import type { ProviderTaskRunner } from "./types.js";

export function createApiRunner(providerName: string, provider: ApiProviderConfig): ProviderTaskRunner {
  const modelFactory = createModelFactory(providerName, provider);
  let messageHistory: ModelMessage[] = [];

  return {
    async runTask({ task, agent, abortSignal }) {
      const userContent = buildTaskPrompt({ task, agent, includeJsonSchema: true });
      const requestMessages = trimMessages(
        [...messageHistory, { role: "user", content: userContent }],
        MAX_HISTORY_MESSAGES + 1
      );

      let result;
      try {
        result = await generateText({
          model: modelFactory(agent.providerModel),
          system: agent.systemPrompt,
          messages: requestMessages,
          temperature: agent.temperature ?? agent.modelConfig.temperature,
          maxOutputTokens: agent.modelConfig.maxOutputTokens,
          abortSignal
        });
      } catch (error) {
        throw wrapGenerateTextError({
          error,
          providerName: agent.providerName,
          providerProtocol: provider.protocol,
          model: agent.providerModel
        });
      }

      messageHistory = trimMessages(
        [...requestMessages, { role: "assistant", content: result.text }],
        MAX_HISTORY_MESSAGES
      );

      return normalizeTaskOutputFromText(task, result.text);
    }
  };
}

const MAX_HISTORY_MESSAGES = 24;

function trimMessages(messages: ModelMessage[], maxMessages: number): ModelMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  return messages.slice(messages.length - maxMessages);
}

function createModelFactory(providerName: string, provider: ApiProviderConfig): (modelId: string) => LanguageModel {
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

  throw new Error(`API key environment variable "${provider.apiKeyEnv}" is not set for provider "${providerName}"`);
}

type WrappedApiErrorArgs = {
  error: unknown;
  providerName: string;
  providerProtocol: ApiProviderConfig["protocol"];
  model: string;
};

function wrapGenerateTextError(args: WrappedApiErrorArgs): Error {
  const kind = classifyApiError(args.error);
  const details = getErrorDetails(args.error);
  const message = [
    `[argue-cli] API call failed for provider '${args.providerName}'`,
    `(protocol: ${args.providerProtocol}, model: ${args.model}, ${kind}).`,
    `Cause: ${details}`
  ].join(" ");

  return new Error(message, { cause: args.error });
}

function classifyApiError(error: unknown): "retryable" | "non-retryable" {
  const statusCode = getStatusCode(error);
  if (statusCode !== undefined) {
    if (statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429 || statusCode >= 500) {
      return "retryable";
    }

    if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 422) {
      return "non-retryable";
    }
  }

  const haystack = getErrorSignature(error);

  if (matchesAny(haystack, RETRYABLE_HINTS)) {
    return "retryable";
  }

  if (matchesAny(haystack, NON_RETRYABLE_HINTS)) {
    return "non-retryable";
  }

  return "non-retryable";
}

function getStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const status = error.statusCode;
  return typeof status === "number" ? status : undefined;
}

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return String(error);
}

function getErrorSignature(error: unknown): string {
  if (!isRecord(error)) {
    return getErrorDetails(error).toLowerCase();
  }

  const fields = [error.name, error.code, error.message]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  return fields.join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function matchesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

const RETRYABLE_HINTS = [
  "rate limit",
  "too many requests",
  "timeout",
  "timed out",
  "temporarily unavailable",
  "service unavailable",
  "network",
  "econnreset",
  "etimedout",
  "eai_again"
] as const;

const NON_RETRYABLE_HINTS = [
  "unauthorized",
  "forbidden",
  "invalid api key",
  "authentication",
  "invalid model",
  "model_not_found",
  "not found"
] as const;
