import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCliConfig, resolveConfigPath } from "../src/config.js";
import { runCli } from "../src/index.js";

const VALID_CONFIG = {
  schemaVersion: 1,
  output: {
    jsonlPath: "./out/{requestId}.events.jsonl",
    resultPath: "./out/{requestId}.result.json"
  },
  defaults: {
    defaultAgents: ["a1", "a2"],
    minRounds: 2,
    maxRounds: 3,
    consensusThreshold: 1,
    composer: "builtin"
  },
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
    { id: "a1", provider: "p1", model: "m1", role: "r1" },
    { id: "a2", provider: "p2", model: "m2", role: "r2" },
    { id: "a3", provider: "p1", model: "m1", role: "r3" }
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

    await writeJson(projectPath, VALID_CONFIG);
    await writeJson(globalPath, VALID_CONFIG);

    const resolved = await resolveConfigPath({ cwd, homeDir: home });
    expect(resolved).toBe(projectPath);
  });

  it("validates provider/model references in agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-validate-"));
    const configPath = join(root, "argue.config.json");

    await writeJson(configPath, {
      ...VALID_CONFIG,
      agents: [
        { id: "a1", provider: "p1", model: "m1" },
        { id: "a2", provider: "p1", model: "missing" }
      ]
    });

    await expect(loadCliConfig({ explicitPath: configPath })).rejects.toThrow(/unknown model/);
  });

  it("run command resolves plan with precedence: flags > input > defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-"));
    const configPath = join(root, "argue.config.json");
    const inputPath = join(root, "topic.json");

    await writeJson(configPath, VALID_CONFIG);
    await writeJson(inputPath, {
      requestId: "from-input",
      topic: "Input topic",
      objective: "Input objective",
      agents: ["a1", "a2"],
      composer: "representative"
    });

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli(
      [
        "run",
        "--config", configPath,
        "--input", inputPath,
        "--topic", "Flag topic",
        "--agents", "a2,a3",
        "--composer", "builtin"
      ],
      {
        log: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg)
      }
    );

    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(errors).toHaveLength(0);

    expect(logs.some((x) => x.includes("topic: Flag topic"))).toBe(true);
    expect(logs.some((x) => x.includes("agents: a2, a3"))).toBe(true);
    expect(logs.some((x) => x.includes("composer: builtin"))).toBe(true);
  });

  it("run command fails when topic/objective are not provided by any source", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-fail-"));
    const configPath = join(root, "argue.config.json");
    await writeJson(configPath, VALID_CONFIG);

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli(["run", "--config", configPath], {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg)
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(errors.some((x) => x.includes("Missing topic"))).toBe(true);
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), "utf8");
}
