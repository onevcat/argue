import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCliConfig, resolveConfigPath } from "../src/config.js";
import { runCli } from "../src/index.js";

const VALID_CONFIG = {
  schemaVersion: 1,
  providers: {
    p1: {
      type: "api",
      protocol: "openai-compatible",
      models: {
        m1: {}
      }
    },
    p2: {
      type: "cli",
      cliType: "claude",
      command: "claude",
      models: {
        m2: {}
      }
    }
  },
  agents: [
    { id: "a1", provider: "p1", model: "m1" },
    { id: "a2", provider: "p2", model: "m2" }
  ]
};

describe("cli config loader", () => {
  it("prefers project config over global config", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-config-"));
    const cwd = join(root, "project");
    const home = join(root, "home");

    await mkdir(cwd, { recursive: true });
    await mkdir(join(home, ".config", "argue"), { recursive: true });

    const projectPath = join(cwd, "argue.config.json");
    const globalPath = join(home, ".config", "argue", "config.json");

    await writeFile(projectPath, JSON.stringify(VALID_CONFIG), "utf8");
    await writeFile(globalPath, JSON.stringify({ ...VALID_CONFIG, schemaVersion: 1 }), "utf8");

    const resolved = await resolveConfigPath({ cwd, homeDir: home });
    expect(resolved).toBe(projectPath);
  });

  it("validates provider/model references in agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-validate-"));
    const configPath = join(root, "argue.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        providers: {
          p1: {
            type: "api",
            protocol: "openai-compatible",
            models: { m1: {} }
          }
        },
        agents: [
          { id: "a1", provider: "p1", model: "m1" },
          { id: "a2", provider: "p1", model: "missing" }
        ]
      }),
      "utf8"
    );

    await expect(loadCliConfig({ explicitPath: configPath })).rejects.toThrow(/unknown model/);
  });

  it("run command loads config and prints resolved paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-"));
    const configPath = join(root, "argue.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        ...VALID_CONFIG,
        output: {
          jsonlPath: "./out/events.jsonl",
          resultPath: "./out/result.json"
        }
      }),
      "utf8"
    );

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli(["run", "--config", configPath], {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg)
    });

    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.some((x) => x.includes("configuration loaded"))).toBe(true);
    expect(logs.some((x) => x.includes("jsonl:"))).toBe(true);
  });
});
