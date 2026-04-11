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
    const runner = createApiRunner({
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
      agent: makeAgent({ systemPrompt: "system", temperature: 0.2 }),
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
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user" })
      ]),
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

    const runner = createApiRunner({
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

    const runner = createApiRunner({
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

    const openAiRunner = createApiRunner({
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
      agent: makeAgent()
    });

    const anthropicRunner = createApiRunner({
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
      agent: makeAgent()
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
    const runner = createApiRunner({
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
      agent: makeAgent()
    });

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
      name: "argue-openai-compatible",
      baseURL: "https://api.groq.com/openai/v1",
      apiKey: "groq-secret",
      headers: undefined,
      supportsStructuredOutputs: true
    });
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

function makeAgent(options?: { systemPrompt?: string; temperature?: number }) {
  return {
    id: "agent-1",
    provider: "api-provider",
    model: "m",
    providerName: "api-provider",
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
