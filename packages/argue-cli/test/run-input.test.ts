import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRunInput } from "../src/run-input.js";

describe("loadRunInput", () => {
  const loadedConfig = {
    configPath: "/tmp/argue.config.json",
    configDir: "/tmp",
    config: {
      schemaVersion: 1,
      providers: { mock: { type: "mock", models: { fake: {} } } },
      agents: [
        { id: "a1", provider: "mock", model: "fake" },
        { id: "a2", provider: "mock", model: "fake" }
      ]
    }
  } as const;

  it("returns empty input when path is omitted", async () => {
    await expect(loadRunInput(undefined, loadedConfig)).resolves.toEqual({});
  });

  it("loads and validates run input json", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-input-"));
    const file = join(root, "run.json");

    await writeFile(file, JSON.stringify({
      topic: "T",
      objective: "O",
      agents: ["a1", "a2"],
      minRounds: 1,
      maxRounds: 2,
      context: { mode: "test" }
    }), "utf8");

    const input = await loadRunInput(file, loadedConfig);
    expect(input.topic).toBe("T");
    expect(input.objective).toBe("O");
    expect(input.context).toEqual({ mode: "test" });
  });

  it("rejects unknown fields because schema is strict", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-input-invalid-"));
    const file = join(root, "run.json");

    await writeFile(file, JSON.stringify({ topic: "T", objective: "O", extra: true }), "utf8");

    await expect(loadRunInput(file, loadedConfig)).rejects.toThrow();
  });
});
