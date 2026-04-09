import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeHeadlessRun } from "../src/headless-run.js";
import type { LoadedCliConfig } from "../src/config.js";
import { resolveRunPlan } from "../src/run-plan.js";

function makeLoadedConfig(root: string): LoadedCliConfig {
  return {
    configPath: join(root, "argue.config.json"),
    configDir: root,
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
        maxRounds: 1,
        composer: "builtin"
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
        { id: "a1", provider: "mock", model: "fake" },
        { id: "a2", provider: "mock", model: "fake" }
      ]
    }
  };
}

describe("executeHeadlessRun", () => {
  it("runs engine and writes jsonl/result/summary artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-headless-"));
    const loadedConfig = makeLoadedConfig(root);

    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "headless",
        topic: "Headless topic",
        objective: "Headless objective"
      }
    });

    const execution = await executeHeadlessRun({ loadedConfig, plan });

    expect(execution.result.status).toBe("consensus");
    expect(execution.jsonlPath).toContain("headless.events.jsonl");

    const resultJson = JSON.parse(await readFile(execution.resultPath, "utf8"));
    const summary = await readFile(execution.summaryPath, "utf8");
    const jsonl = await readFile(execution.jsonlPath, "utf8");

    expect(resultJson.requestId).toBe("headless");
    expect(summary).toContain("# argue run headless");
    expect(jsonl.trim().split("\n").length).toBeGreaterThan(1);
  });
});
