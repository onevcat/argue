import type { AgentTaskInput } from "argue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VENDOR_PRESETS } from "../src/vendors.js";
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
  const envKeys = ["OPENAI_TEST_KEY", "ANTHROPIC_TEST_KEY", "GROQ_API_KEY"] as const;
  const envBackup = new Map<string, string | undefined>(envKeys.map((key) => [key, process.env[key]]));

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

  it("wires generateText invocation options and model factory for openai-compatible", async () => {
    process.env.OPENAI_TEST_KEY = "openai-secret";
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        fullResponse: "full",
        summary: "summary",
        extractedClaims: [],
        judgements: []
      })
    });

    const abortController = new AbortController();
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
      agent: makeAgent("openai-provider", { systemPrompt: "system", temperature: 0.2 }),
      abortSignal: abortController.signal
    });

    expect(mockCreateOpenAICompatible).toHaveBeenCalledTimes(1);
    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
      name: "argue-openai-compatible",
      baseURL: "https://example.openai/v1",
      apiKey: "openai-secret",
      headers: {
        "x-test": "1"
      },
      supportsStructuredOutputs: true
    });

    expect(mockOpenAILanguageModel).toHaveBeenCalledWith("gpt-test");
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(mockGenerateText).toHaveBeenCalledWith({
      model: "openai-model-instance",
      system: "system",
      messages: expect.arrayContaining([expect.objectContaining({ role: "user" })]),
      temperature: 0.2,
      maxOutputTokens: 777,
      abortSignal: abortController.signal
    });
  });

  it("normalizes JSON text through normalizeTaskOutputFromText into round result shape", async () => {
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        fullResponse: "Detailed answer",
        summary: "Concise summary",
        extractedClaims: [
          {
            claimId: "c-1",
            title: "Title 1",
            statement: "Statement 1",
            category: "pro"
          }
        ],
        judgements: [
          {
            claimId: "c-1",
            stance: "agree",
            confidence: 0.9,
            rationale: "Reason"
          }
        ]
      })
    });

    const runner = createApiRunner("api-provider", {
      type: "api",
      protocol: "openai-compatible",
      models: {
        m: {}
      }
    });

    const result = await runner.runTask({
      task: makeInitialRoundTask("task-normalize"),
      agent: makeAgent()
    });

    expect(result).toEqual({
      kind: "round",
      output: {
        participantId: "agent-1",
        phase: "initial",
        round: 0,
        fullResponse: "Detailed answer",
        summary: "Concise summary",
        extractedClaims: [
          {
            claimId: "c-1",
            title: "Title 1",
            statement: "Statement 1",
            category: "pro"
          }
        ],
        judgements: [
          {
            claimId: "c-1",
            stance: "agree",
            confidence: 0.9,
            rationale: "Reason"
          }
        ]
      }
    });
  });

  it("accumulates multi-turn messages between calls", async () => {
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify({
          fullResponse: "first",
          summary: "first",
          extractedClaims: [],
          judgements: []
        })
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          fullResponse: "second",
          summary: "second",
          extractedClaims: [],
          judgements: []
        })
      });

    const runner = createApiRunner("api-provider", {
      type: "api",
      protocol: "openai-compatible",
      models: {
        m: {}
      }
    });

    await runner.runTask({
      task: makeInitialRoundTask("turn-1"),
      agent: makeAgent()
    });
    await runner.runTask({
      task: makeInitialRoundTask("turn-2"),
      agent: makeAgent()
    });

    const secondCallArgs = mockGenerateText.mock.calls[1]?.[0];
    const secondMessages = secondCallArgs?.messages as Array<{ role: string; content: string }>;
    expect(secondMessages.length).toBeGreaterThanOrEqual(3);
    expect(secondMessages[0]?.role).toBe("user");
    expect(secondMessages[1]).toEqual({
      role: "assistant",
      content: JSON.stringify({
        fullResponse: "first",
        summary: "first",
        extractedClaims: [],
        judgements: []
      })
    });
    expect(secondMessages[2]?.role).toBe("user");
    expect(secondMessages[0]?.content).toContain("turn-1");
    expect(secondMessages[2]?.content).toContain("turn-2");
  });

  it("forwards protocol-specific factory options for openai-compatible and anthropic-compatible", async () => {
    process.env.OPENAI_TEST_KEY = "openai-k";
    process.env.ANTHROPIC_TEST_KEY = "anthropic-k";
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    mockAnthropicLanguageModel.mockReturnValue("anthropic-model-instance");
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        fullResponse: "ok",
        summary: "ok",
        extractedClaims: [],
        judgements: []
      })
    });

    const openAiRunner = createApiRunner("openai-provider", {
      type: "api",
      protocol: "openai-compatible",
      baseUrl: "https://custom-openai/v1",
      apiKeyEnv: "OPENAI_TEST_KEY",
      headers: { "x-openai": "yes" },
      models: {
        m: {}
      }
    });
    await openAiRunner.runTask({
      task: makeInitialRoundTask("openai"),
      agent: makeAgent("openai-provider")
    });

    const anthropicRunner = createApiRunner("anthropic-provider", {
      type: "api",
      protocol: "anthropic-compatible",
      baseUrl: "https://custom-anthropic/v1",
      apiKeyEnv: "ANTHROPIC_TEST_KEY",
      headers: { "x-anthropic": "yes" },
      models: {
        m: {}
      }
    });
    await anthropicRunner.runTask({
      task: makeInitialRoundTask("anthropic"),
      agent: makeAgent("anthropic-provider")
    });

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
      name: "argue-openai-compatible",
      baseURL: "https://custom-openai/v1",
      apiKey: "openai-k",
      headers: { "x-openai": "yes" },
      supportsStructuredOutputs: true
    });
    expect(mockCreateAnthropic).toHaveBeenCalledWith({
      name: "argue-anthropic-compatible",
      baseURL: "https://custom-anthropic/v1",
      apiKey: "anthropic-k",
      headers: { "x-anthropic": "yes" }
    });
  });

  it("accepts vendor preset config and forwards preset baseUrl/apiKeyEnv to factory", async () => {
    process.env.GROQ_API_KEY = "groq-secret";
    mockOpenAILanguageModel.mockReturnValue("groq-model-instance");
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        fullResponse: "groq",
        summary: "groq",
        extractedClaims: [],
        judgements: []
      })
    });

    const groqPreset = VENDOR_PRESETS.groq;
    const runner = createApiRunner("groq-provider", {
      type: "api",
      protocol: groqPreset.protocol,
      apiKeyEnv: groqPreset.apiKeyEnv,
      baseUrl: groqPreset.baseUrl,
      models: {
        m: {}
      }
    });

    await runner.runTask({
      task: makeInitialRoundTask("groq"),
      agent: makeAgent("groq-provider")
    });

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
      name: "argue-openai-compatible",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: "groq-secret",
      headers: undefined,
      supportsStructuredOutputs: true
    });
  });

  it("throws a clear error when an openai-compatible apiKeyEnv is missing", () => {
    delete process.env.OPENAI_TEST_KEY;

    expect(() =>
      createApiRunner("openai-provider", {
        type: "api",
        protocol: "openai-compatible",
        apiKeyEnv: "OPENAI_TEST_KEY",
        models: {
          m: {}
        }
      })
    ).toThrow('API key environment variable "OPENAI_TEST_KEY" is not set for provider "openai-provider"');
  });

  it("throws a clear error when an anthropic-compatible apiKeyEnv is empty", () => {
    process.env.ANTHROPIC_TEST_KEY = "   ";

    expect(() =>
      createApiRunner("anthropic-provider", {
        type: "api",
        protocol: "anthropic-compatible",
        apiKeyEnv: "ANTHROPIC_TEST_KEY",
        models: {
          m: {}
        }
      })
    ).toThrow('API key environment variable "ANTHROPIC_TEST_KEY" is not set for provider "anthropic-provider"');
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

function makeAgent(providerName = "api-provider", options?: { systemPrompt?: string; temperature?: number }) {
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
    providerModel: "gpt-test",
    systemPrompt: options?.systemPrompt,
    temperature: options?.temperature
  };
}
