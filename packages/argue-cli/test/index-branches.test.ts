import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

type IOLogs = { logs: string[]; errors: string[] };

function createIO(): IOLogs & { log: (msg: string) => void; error: (msg: string) => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg)
  };
}

describe("runCli command branches", () => {
  it("supports help/version aliases and unknown commands", async () => {
    for (const cmd of ["help", "--help", "-h"]) {
      const io = createIO();
      const result = await runCli([cmd], io);
      expect(result).toEqual({ ok: true, code: 0 });
      expect(io.logs.some((x) => x.includes("Usage:"))).toBe(true);
    }

    for (const cmd of ["version", "--version", "-v"]) {
      const io = createIO();
      const result = await runCli([cmd], io);
      expect(result).toEqual({ ok: true, code: 0 });
      expect(io.logs).toContain("argue-cli v0.1.0");
    }

    const io = createIO();
    const result = await runCli(["wat"], io);
    expect(result).toEqual({ ok: false, code: 1 });
    expect(io.errors.some((x) => x.includes("Unknown command: wat"))).toBe(true);
  });

  it("treats 'tui' as unknown command", async () => {
    const io = createIO();
    const result = await runCli(["tui"], io);
    expect(result).toEqual({ ok: false, code: 1 });
    expect(io.errors.some((x) => x.includes("Unknown command: tui"))).toBe(true);
  });

  it("returns parser errors for missing option values and invalid values", async () => {
    const missingValueCases: Array<{ args: string[]; message: string }> = [
      { args: ["run", "--config"], message: "--config requires a path" },
      { args: ["run", "--input"], message: "--input requires a path" },
      { args: ["run", "--agents"], message: "--agents requires comma-separated ids" },
      { args: ["run", "--request-id"], message: "--request-id requires a value" },
      { args: ["run", "--task"], message: "--task requires a value" },
      { args: ["run", "--jsonl"], message: "--jsonl requires a path" },
      { args: ["run", "--result"], message: "--result requires a path" },
      { args: ["run", "--summary"], message: "--summary requires a path" },
      { args: ["run", "--min-rounds"], message: "--min-rounds requires a value" },
      { args: ["run", "--max-rounds"], message: "--max-rounds requires a value" },
      { args: ["run", "--per-task-timeout-ms"], message: "--per-task-timeout-ms requires a value" },
      { args: ["run", "--per-round-timeout-ms"], message: "--per-round-timeout-ms requires a value" },
      { args: ["run", "--global-deadline-ms"], message: "--global-deadline-ms requires a value" },
      { args: ["run", "--threshold"], message: "--threshold requires a value" },
      { args: ["run", "--representative-id"], message: "--representative-id requires a value" },
      { args: ["run", "--language"], message: "--language requires a value" },
      { args: ["run", "--token-budget"], message: "--token-budget requires a value" }
    ];

    for (const testCase of missingValueCases) {
      const io = createIO();
      const result = await runCli(testCase.args, io);
      expect(result).toEqual({ ok: false, code: 1 });
      expect(io.errors).toContain(testCase.message);
    }

    for (const [args, message] of [
      [["run", "--composer", "bad"], "--composer must be builtin or representative"],
      [["run", "--trace-level", "bad"], "--trace-level must be compact or full"],
      [["run", "--unknown"], "Unknown option for run: --unknown"],
      [["run", "--min-rounds", "9007199254740993123"], "--min-rounds must be a safe integer"],
      [["run", "--threshold", "1e999"], "--threshold must be a number"]
    ] as const) {
      const io = createIO();
      const result = await runCli(args as string[], io);
      expect(result).toEqual({ ok: false, code: 1 });
      expect(io.errors).toContain(message);
    }
  });

  it("returns parser errors for config mutation commands", async () => {
    for (const [args, message] of [
      [["config"], "Unknown config subcommand"],
      [["config", "add-provider", "--type", "mock", "--model-id", "m1"], "Missing provider id"],
      [["config", "add-provider", "--id", "p3", "--type", "api", "--model-id", "m1"], "API provider requires --protocol"],
      [["config", "add-agent", "--id", "a4", "--provider", "p1"], "Missing model id"],
      [["config", "add-agent", "--id", "a4", "--provider", "p1", "--model", "m1", "--unknown"], "Unknown option for config add-agent: --unknown"]
    ] as const) {
      const io = createIO();
      const result = await runCli(args as string[], io);
      expect(result).toEqual({ ok: false, code: 1 });
      expect(io.errors.some((x) => x.includes(message))).toBe(true);
    }
  });

  it("propagates execute failure in run path", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-fail-exec-"));
    const configPath = join(root, "argue.config.json");

    await writeFile(configPath, JSON.stringify({
      schemaVersion: 1,
      output: {
        resultPath: "/dev/null/fail.result.json",
        summaryPath: "/dev/null/fail.summary.md",
        jsonlPath: "./out/{requestId}.events.jsonl"
      },
      defaults: {
        defaultAgents: ["a1", "a2"],
        minRounds: 1,
        maxRounds: 1
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
    }), "utf8");

    const io = createIO();
    const result = await runCli([
      "run",
      "--config", configPath,
      "--task", "t",
      "--request-id", "fail-run"
    ], io);

    expect(result).toEqual({ ok: false, code: 1 });
    expect(io.errors.length).toBeGreaterThan(0);
  });

  it("accepts --trace/--trace-level and writes traced report", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-trace-"));
    const configPath = join(root, "argue.config.json");

    await writeFile(configPath, JSON.stringify({
      schemaVersion: 1,
      output: {
        resultPath: "./out/{requestId}.result.json",
        jsonlPath: "./out/{requestId}.events.jsonl",
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
    }), "utf8");

    const io = createIO();
    const result = await runCli([
      "run",
      "--config", configPath,
      "--request-id", "trace-run",
      "--task", "t",
      "--agents", "a1,a2",
      "--trace",
      "--trace-level", "full"
    ], io);

    expect(result).toEqual({ ok: true, code: 0 });
    expect(io.logs.some((x) => x.includes("agents: a1, a2"))).toBe(true);

    const resultJson = JSON.parse(await readFile(join(root, "out", "trace-run.result.json"), "utf8"));
    expect(resultJson.report.traceIncluded).toBe(true);
    expect(resultJson.report.traceLevel).toBe("full");
  });

  it("prints live headless progress with round and claim signals", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-run-progress-"));
    const configPath = join(root, "argue.config.json");

    await writeFile(configPath, JSON.stringify({
      schemaVersion: 1,
      output: {
        resultPath: "./out/{requestId}.result.json",
        jsonlPath: "./out/{requestId}.events.jsonl",
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
    }), "utf8");

    const io = createIO();
    const result = await runCli([
      "run",
      "--config", configPath,
      "--request-id", "progress-run",
      "--task", "t"
    ], io);

    expect(result).toEqual({ ok: true, code: 0 });
    expect(io.logs.some((x) => x.includes("initial#0") && x.includes("dispatched"))).toBe(true);
    expect(io.logs.some((x) => x.includes("initial#0") && x.includes("responded") && x.includes("claims+"))).toBe(true);
    expect(io.logs.some((x) => x.includes("initial#0") && x.includes("completed") && x.includes("claims="))).toBe(true);
  });
});
