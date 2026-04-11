import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTaskInput } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import { createSdkRunner } from "../src/runtime/sdk.js";

function makeRoundTask(): AgentTaskInput {
  return {
    kind: "round",
    sessionId: "s1",
    requestId: "r1",
    participantId: "a1",
    phase: "initial",
    round: 0,
    prompt: "p",
    claimCatalog: []
  };
}

describe("createSdkRunner", () => {
  it("loads local adapter and forwards environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-sdk-runner-"));
    const adapterPath = join(root, "adapter.mjs");

    await writeFile(
      adapterPath,
      `
export function createArgueSdkAdapter(args) {
  return {
    async runTask({ task, environment }) {
      return {
        fullResponse: "sdk:" + String(environment.SDK_MARK),
        summary: task.prompt,
        extractedClaims: [],
        judgements: []
      };
    }
  };
}
`,
      "utf8"
    );

    const runner = await createSdkRunner(
      "sdk-provider",
      {
        type: "sdk",
        adapter: "./adapter.mjs",
        env: {
          SDK_MARK: "ok"
        },
        models: {
          fake: {}
        }
      },
      root
    );

    const result = await runner.runTask({
      task: makeRoundTask(),
      agent: {
        id: "a1",
        provider: "sdk-provider",
        model: "fake",
        providerName: "sdk-provider",
        providerConfig: {
          type: "sdk",
          adapter: "./adapter.mjs",
          models: {
            fake: {}
          }
        },
        modelConfig: {},
        providerModel: "fake"
      }
    });

    expect(result).toEqual({
      fullResponse: "sdk:ok",
      summary: "p",
      extractedClaims: [],
      judgements: []
    });
  });

  it("throws when adapter export is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-sdk-missing-"));
    const adapterPath = join(root, "adapter.mjs");
    await writeFile(adapterPath, "export const noop = 1;", "utf8");

    await expect(
      createSdkRunner(
        "sdk-provider",
        {
          type: "sdk",
          adapter: "./adapter.mjs",
          models: {
            fake: {}
          }
        },
        root
      )
    ).rejects.toThrow(/missing export/);
  });
});
