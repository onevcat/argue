import type { AgentTaskInput } from "argue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiRunner } from "../src/runtime/api.js";

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockOpenAILanguageModel = vi.hoisted(() => vi.fn());
const mockAnthropicLanguageModel = vi.hoisted(() => vi.fn());
const mockCreateOpenAICompatible = vi.hoisted(() =>
  vi.fn(() => ({
    languageModel: mockOpenAILanguageModel
  }))
);
const mockCreateAnthropic = vi.hoisted(() =>
  vi.fn(() => ({
    languageModel: mockAnthropicLanguageModel
  }))
);

vi.mock("ai", () => ({
  generateText: mockGenerateText
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mockCreateOpenAICompatible
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mockCreateAnthropic
}));

describe("createApiRunner", () => {
  const envKeys = ["OPENAI_TEST_KEY", "ANTHROPIC_TEST_KEY"] as const;
  const envBackup = new Map<string, string | undefined>(
    envKeys.map((key) => [key, process.env[key]])
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    for (const key of envKeys) {
      const value = envBackup.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("passes a resolved openai-compatible API key into the SDK factory", async () => {
    process.env.OPENAI_TEST_KEY = "openai-secret";
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        fullResponse: "ok",
        summary: "ok",
        extractedClaims: [],
        judgements: []
      })
    });

    const runner = createApiRunner("openai-provider", {
      type: "api",
      protocol: "openai-compatible",
      baseUrl: "https://example.openai/v1",
      apiKeyEnv: "OPENAI_TEST_KEY",
      headers: {
        "x-test": "1"
      },
      models: {
        m: {}
      }
    });

    await runner.runTask({
      task: makeInitialRoundTask("task-1"),
      agent: makeAgent("openai-provider")
    });

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
      name: "argue-openai-compatible",
      baseURL: "https://example.openai/v1",
      apiKey: "openai-secret",
      headers: {
        "x-test": "1"
      },
      supportsStructuredOutputs: true
    });
  });

  it("throws a clear error when an openai-compatible apiKeyEnv is missing", () => {
    delete process.env.OPENAI_TEST_KEY;

    expect(() => createApiRunner("openai-provider", {
      type: "api",
      protocol: "openai-compatible",
      apiKeyEnv: "OPENAI_TEST_KEY",
      models: {
        m: {}
      }
    })).toThrow(
      'API key environment variable "OPENAI_TEST_KEY" is not set for provider "openai-provider"'
    );
  });

  it("throws a clear error when an anthropic-compatible apiKeyEnv is empty", () => {
    process.env.ANTHROPIC_TEST_KEY = "   ";

    expect(() => createApiRunner("anthropic-provider", {
      type: "api",
      protocol: "anthropic-compatible",
      apiKeyEnv: "ANTHROPIC_TEST_KEY",
      models: {
        m: {}
      }
    })).toThrow(
      'API key environment variable "ANTHROPIC_TEST_KEY" is not set for provider "anthropic-provider"'
    );
  });

  it("adds provider/model context and retryability for rate-limit errors", async () => {
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    const rateLimitError = new Error("Rate limit exceeded");
    mockGenerateText.mockRejectedValue(rateLimitError);

    const runner = createApiRunner("api-provider", {
      type: "api",
      protocol: "openai-compatible",
      models: { m: {} }
    });

    await expect(
      runner.runTask({
        task: makeInitialRoundTask("task-1"),
        agent: makeAgent("api-provider")
      })
    ).rejects.toThrow(
      "[argue-cli] API call failed for provider 'api-provider' (protocol: openai-compatible, model: gpt-test, retryable). Cause: Rate limit exceeded"
    );
  });

  it("marks auth/model style failures as non-retryable", async () => {
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    const authError = Object.assign(new Error("Unauthorized: invalid api key"), {
      statusCode: 401
    });
    mockGenerateText.mockRejectedValue(authError);

    const runner = createApiRunner("api-provider", {
      type: "api",
      protocol: "openai-compatible",
      models: { m: {} }
    });

    try {
      await runner.runTask({
        task: makeInitialRoundTask("task-1"),
        agent: makeAgent("api-provider")
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const wrapped = error as Error;
      expect(wrapped.message).toContain("non-retryable");
      expect(wrapped.message).toContain("model: gpt-test");
      expect(wrapped.cause).toBe(authError);
    }
  });
});

function makeInitialRoundTask(prompt: string): AgentTaskInput {
  return {
    kind: "round",
    sessionId: "session-1",
    requestId: "request-1",
    participantId: "agent-1",
    phase: "initial",
    round: 0,
    prompt,
    claimCatalog: []
  };
}

function makeAgent(providerName: string) {
  return {
    id: "agent-1",
    provider: providerName,
    model: "m",
    providerName,
    providerConfig: {
      type: "api" as const,
      protocol: "openai-compatible" as const,
      models: {
        m: {}
      }
    },
    modelConfig: {
      maxOutputTokens: 777,
      temperature: 0.55
    },
    providerModel: "gpt-test"
  };
}
