import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

const RUNNABLE_CONFIG = {
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
    consensusThreshold: 1,
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
    { id: "a1", provider: "mock", model: "fake", role: "r1" },
    { id: "a2", provider: "mock", model: "fake", role: "r2" },
    { id: "a3", provider: "mock", model: "fake", role: "r3" }
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

  it("adds provider via config command", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-add-provider-"));
    const configPath = join(root, "argue.config.json");
    await writeJson(configPath, VALID_CONFIG);

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli([
      "config",
      "add-provider",
      "--config", configPath,
      "--id", "p3",
      "--type", "api",
      "--protocol", "openai-compatible",
      "--model-id", "m3",
      "--provider-model", "gpt-5-mini"
    ], {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg)
    });

    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.some((x) => x.includes("provider added: p3"))).toBe(true);

    const loaded = await loadCliConfig({ explicitPath: configPath });
    expect(loaded.config.providers.p3).toBeDefined();
    expect(loaded.config.providers.p3?.type).toBe("api");
    expect(loaded.config.providers.p3?.models.m3?.providerModel).toBe("gpt-5-mini");
  });

  it("adds agent via config command", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-add-agent-"));
    const configPath = join(root, "argue.config.json");
    await writeJson(configPath, VALID_CONFIG);

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli([
      "config",
      "add-agent",
      "--config", configPath,
      "--id", "a4",
      "--provider", "p1",
      "--model", "m1",
      "--role", "new-role",
      "--timeout-ms", "30000"
    ], {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg)
    });

    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.some((x) => x.includes("agent added: a4"))).toBe(true);

    const loaded = await loadCliConfig({ explicitPath: configPath });
    const a4 = loaded.config.agents.find((agent) => agent.id === "a4");
    expect(a4).toBeDefined();
    expect(a4?.provider).toBe("p1");
    expect(a4?.model).toBe("m1");
    expect(a4?.role).toBe("new-role");
    expect(a4?.timeoutMs).toBe(30000);
  });

  it("fails config command on duplicate/unknown references", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-config-mutation-fail-"));
    const configPath = join(root, "argue.config.json");
    await writeJson(configPath, VALID_CONFIG);

    const duplicateErrors: string[] = [];
    const duplicateResult = await runCli([
      "config",
      "add-provider",
      "--config", configPath,
      "--id", "p1",
      "--type", "mock",
      "--model-id", "m"
    ], {
      log: () => {},
      error: (msg: string) => duplicateErrors.push(msg)
    });

    expect(duplicateResult.ok).toBe(false);
    expect(duplicateErrors.some((x) => x.includes("Provider id already exists: p1"))).toBe(true);

    const unknownErrors: string[] = [];
    const unknownResult = await runCli([
      "config",
      "add-agent",
      "--config", configPath,
      "--id", "a4",
      "--provider", "missing",
      "--model", "m1"
    ], {
      log: () => {},
      error: (msg: string) => unknownErrors.push(msg)
    });

    expect(unknownResult.ok).toBe(false);
    expect(unknownErrors.some((x) => x.includes("Unknown provider: missing"))).toBe(true);

    const raw = await readFile(configPath, "utf8");
    const json = JSON.parse(raw) as { providers: Record<string, unknown>; agents: Array<{ id: string }> };
    expect(Object.keys(json.providers)).toHaveLength(2);
    expect(json.agents.some((agent) => agent.id === "a4")).toBe(false);
  });

  it("run command resolves plan with precedence: flags > input > defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-"));
    const configPath = join(root, "argue.config.json");
    const inputPath = join(root, "task.json");

    await writeJson(configPath, RUNNABLE_CONFIG);
    await writeJson(inputPath, {
      requestId: "from-input",
      task: "Input topic",
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
        "--task", "Flag topic",
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

    expect(logs.some((x) => x.includes("task: Flag topic"))).toBe(true);
    expect(logs.some((x) => x.includes("agents: a2, a3"))).toBe(true);
    expect(logs.some((x) => x.includes("composer: builtin"))).toBe(true);
  });

  it("supports exec as alias of run", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-exec-"));
    const configPath = join(root, "argue.config.json");
    await writeJson(configPath, RUNNABLE_CONFIG);

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli(
      ["exec", "--config", configPath, "--task", "Alias topic"],
      {
        log: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg)
      }
    );

    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.some((x) => x.includes("run plan resolved"))).toBe(true);
  });

  it("defaults to TUI on bare command when TTY is available", async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli([], {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg)
    }, { isTTY: true });

    expect(result.ok).toBe(true);
    expect(result.code).toBe(0);
    expect(errors).toHaveLength(0);
    expect(logs.some((x) => x.includes("entering TUI mode"))).toBe(true);
  });

  it("bare command fails without TTY and suggests headless mode", async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli([], {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg)
    }, { isTTY: false });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(logs).toHaveLength(0);
    expect(errors.some((x) => x.includes("No TTY detected"))).toBe(true);
  });

  it("rejects loosely-typed integer arguments", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-int-parse-"));
    const configPath = join(root, "argue.config.json");
    await writeJson(configPath, VALID_CONFIG);

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli(
      ["run", "--config", configPath, "--task", "t", "--max-rounds", "10abc"],
      {
        log: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg)
      }
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(errors.some((x) => x.includes("--max-rounds must be an integer"))).toBe(true);
  });

  it("rejects loosely-typed float arguments", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-float-parse-"));
    const configPath = join(root, "argue.config.json");
    await writeJson(configPath, VALID_CONFIG);

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli(
      ["run", "--config", configPath, "--task", "t", "--threshold", "0.8foo"],
      {
        log: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg)
      }
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(errors.some((x) => x.includes("--threshold must be a number"))).toBe(true);
  });

  it("run command fails when task is not provided by any source", async () => {
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
    expect(errors.some((x) => x.includes("Missing task"))).toBe(true);
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value), "utf8");
}
