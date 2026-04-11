import type { AgentTaskInput } from "argue";
import { describe, expect, it, vi } from "vitest";
import { createApiRunner } from "../src/runtime/api.js";

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockOpenAILanguageModel = vi.hoisted(() => vi.fn());
const mockCreateOpenAICompatible = vi.hoisted(() =>
  vi.fn(() => ({
    languageModel: mockOpenAILanguageModel
  }))
);

vi.mock("ai", () => ({
  generateText: mockGenerateText
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mockCreateOpenAICompatible
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => ({
    languageModel: vi.fn()
  }))
}));

describe("createApiRunner", () => {
  it("adds provider/model context and retryability for rate-limit errors", async () => {
    mockOpenAILanguageModel.mockReturnValue("openai-model-instance");
    const rateLimitError = new Error("Rate limit exceeded");
    mockGenerateText.mockRejectedValue(rateLimitError);

    const runner = createApiRunner({
      type: "api",
      protocol: "openai-compatible",
      models: { m: {} }
    });

    await expect(
      runner.runTask({
        task: makeInitialRoundTask("task-1"),
        agent: makeAgent()
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

    const runner = createApiRunner({
      type: "api",
      protocol: "openai-compatible",
      models: { m: {} }
    });

    try {
      await runner.runTask({
        task: makeInitialRoundTask("task-1"),
        agent: makeAgent()
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

function makeAgent() {
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
    providerModel: "gpt-test"
  };
}
