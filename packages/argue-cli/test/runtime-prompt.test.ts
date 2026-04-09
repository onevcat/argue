import type { AgentTaskInput } from "argue";
import { describe, expect, it } from "vitest";
import { buildTaskPrompt } from "../src/runtime/prompt.js";

function makeRoundTask(): AgentTaskInput {
  return {
    kind: "round",
    sessionId: "s1",
    requestId: "r1",
    participantId: "a1",
    phase: "debate",
    round: 1,
    prompt: "Round prompt",
    claimCatalog: []
  };
}

describe("buildTaskPrompt", () => {
  it("includes role/system/task context and json schema when enabled", () => {
    const text = buildTaskPrompt({
      task: makeRoundTask(),
      agent: {
        id: "a1",
        provider: "mock",
        model: "fake",
        providerName: "mock",
        providerConfig: { type: "mock", models: { fake: {} } },
        modelConfig: {},
        providerModel: "fake",
        role: "architect",
        systemPrompt: "Be strict"
      },
      includeJsonSchema: true
    });

    expect(text).toContain("Role: architect");
    expect(text).toContain("System instructions:");
    expect(text).toContain("Round prompt");
    expect(text).toContain("Task context JSON:");
    expect(text).toContain("Expected output JSON schema:");
  });

  it("omits schema section when includeJsonSchema is false", () => {
    const text = buildTaskPrompt({
      task: makeRoundTask(),
      agent: {
        id: "a1",
        provider: "mock",
        model: "fake",
        providerName: "mock",
        providerConfig: { type: "mock", models: { fake: {} } },
        modelConfig: {},
        providerModel: "fake"
      },
      includeJsonSchema: false
    });

    expect(text).not.toContain("Expected output JSON schema:");
  });
});
