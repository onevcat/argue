import { describe, expect, it } from "vitest";
import type { LoadedCliConfig } from "../src/config.js";
import { resolveRunPlan } from "../src/run-plan.js";

function makeLoadedConfig(): LoadedCliConfig {
  return {
    configPath: "/tmp/argue.config.json",
    configDir: "/tmp/project",
    config: {
      schemaVersion: 1,
      output: {
        jsonlPath: "./out/{requestId}.events.jsonl",
        resultPath: "./out/{requestId}.result.json",
        summaryPath: "./out/{requestId}.summary.md"
      },
      defaults: {
        defaultAgents: ["a1", "a2"],
        minRounds: 1,
        maxRounds: 3,
        perTaskTimeoutMs: 100,
        perRoundTimeoutMs: 200,
        consensusThreshold: 0.8,
        composer: "builtin",
        includeDeliberationTrace: true,
        traceLevel: "full",
        language: "zh",
        tokenBudgetHint: 1200
      },
      providers: {
        mock: {
          type: "mock",
          models: {
            fake: {}
          }
        }
      },
      agents: [
        { id: "a1", provider: "mock", model: "fake", role: "r1" },
        { id: "a2", provider: "mock", model: "fake", role: "r2" },
        { id: "a3", provider: "mock", model: "fake", role: "r3" }
      ]
    }
  };
}

describe("resolveRunPlan", () => {
  it("applies precedence: flags > runInput > defaults", () => {
    const loadedConfig = makeLoadedConfig();

    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {
        requestId: "from-input",
        task: "Input topic",
        agents: ["a1", "a2"],
        composer: "representative",
        language: "en"
      },
      overrides: {
        requestId: "from-flag",
        task: "Flag topic",
        agents: ["a2", "a3", "a2"],
        composer: "builtin"
      }
    });

    expect(plan.requestId).toBe("from-flag");
    expect(plan.task).toBe("Flag topic");
    expect(plan.participantIds).toEqual(["a2", "a3"]);
    expect(plan.startInput.reportPolicy.composer).toBe("builtin");
    expect(plan.startInput.constraints?.language).toBe("en");
  });

  it("resolves output paths using requestId template", () => {
    const loadedConfig = makeLoadedConfig();

    const plan = resolveRunPlan({
      loadedConfig,
      runInput: { task: "t" },
      overrides: { requestId: "abc" }
    });

    expect(plan.jsonlPath).toBe("/tmp/project/out/abc.events.jsonl");
    expect(plan.resultPath).toBe("/tmp/project/out/abc.result.json");
    expect(plan.summaryPath).toBe("/tmp/project/out/abc.summary.md");
  });

  it("keeps task as the only required input field", () => {
    const loadedConfig = makeLoadedConfig();

    const plan = resolveRunPlan({
      loadedConfig,
      runInput: { task: "t" },
      overrides: {}
    });

    expect(plan.task).toBe("t");
  });

  it("throws when rounds are invalid", () => {
    const loadedConfig = makeLoadedConfig();

    expect(() =>
      resolveRunPlan({
        loadedConfig,
        runInput: { task: "t" },
        overrides: { minRounds: 3, maxRounds: 1 }
      })
    ).toThrow(/maxRounds must be >= minRounds/);
  });

  it("allows representative composer without explicit representativeId", () => {
    const loadedConfig = makeLoadedConfig();

    const plan = resolveRunPlan({
      loadedConfig,
      runInput: { task: "t", composer: "representative" },
      overrides: {}
    });
    expect(plan.startInput.reportPolicy.composer).toBe("representative");
    expect(plan.startInput.reportPolicy.representativeId).toBeUndefined();
  });

  it("throws when selected agents are unknown", () => {
    const loadedConfig = makeLoadedConfig();

    expect(() =>
      resolveRunPlan({
        loadedConfig,
        runInput: { task: "t" },
        overrides: { agents: ["a1", "ghost"] }
      })
    ).toThrow(/Unknown agent id in selection/);
  });

  it("generates a collision-resistant default requestId when none is supplied", () => {
    const loadedConfig = makeLoadedConfig();

    const plan = resolveRunPlan({
      loadedConfig,
      runInput: { task: "t" },
      overrides: {}
    });

    expect(plan.requestId).toMatch(/^argue_\d+_[a-f0-9]{6}$/);
  });

  it("respects includeFullResult from run input and CLI override", () => {
    const loadedConfig = makeLoadedConfig();

    const fromInput = resolveRunPlan({
      loadedConfig,
      runInput: {
        task: "t",
        action: {
          prompt: "Act",
          actorId: "a1",
          includeFullResult: false
        }
      },
      overrides: {}
    });

    expect(fromInput.startInput.actionPolicy).toEqual({
      prompt: "Act",
      actorId: "a1",
      includeFullResult: false
    });

    const fromFlag = resolveRunPlan({
      loadedConfig,
      runInput: {
        task: "t",
        action: {
          prompt: "Act",
          actorId: "a1",
          includeFullResult: true
        }
      },
      overrides: {
        noActionFullResult: true
      }
    });

    expect(fromFlag.startInput.actionPolicy).toEqual({
      prompt: "Act",
      actorId: "a1",
      includeFullResult: false
    });
  });
});
