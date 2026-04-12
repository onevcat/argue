import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTaskInput } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import { resolveRunPlan } from "../src/run-plan.js";
import { createTaskDelegate } from "../src/runtime/delegate.js";

describe("createTaskDelegate task lifecycle", () => {
  it("cleans task record after awaitResult completes", async () => {
    const loadedConfig = makeLoadedConfig({ delayMs: 0 });
    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "req-cleanup",
        task: "topic"
      }
    });

    const delegate = await createTaskDelegate({ loadedConfig, plan });

    const dispatch = await delegate.dispatch(
      makeRoundTask({
        requestId: "req-cleanup",
        sessionId: "s1",
        participantId: "a1"
      })
    );

    const first = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(first.ok).toBe(true);

    const second = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(second.ok).toBe(false);
    expect(second.error).toContain("unknown_task_id");
  });

  it("cleans task record after cancel", async () => {
    const loadedConfig = makeLoadedConfig({ delayMs: 0 });
    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "req-cancel",
        task: "topic"
      }
    });

    const delegate = await createTaskDelegate({ loadedConfig, plan });

    const dispatch = await delegate.dispatch(
      makeRoundTask({
        requestId: "req-cancel",
        sessionId: "s2",
        participantId: "a1"
      })
    );

    await delegate.cancel?.(dispatch.taskId);

    const afterCancel = await delegate.awaitResult(dispatch.taskId, 1000);
    expect(afterCancel.ok).toBe(false);
    expect(afterCancel.error).toContain("unknown_task_id");
  });

  it("throws when dispatching unknown agent id", async () => {
    const loadedConfig = makeLoadedConfig({ delayMs: 0 });
    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "req-unknown-agent",
        task: "topic"
      }
    });

    const delegate = await createTaskDelegate({ loadedConfig, plan });

    await expect(
      delegate.dispatch(
        makeRoundTask({
          requestId: "req-unknown-agent",
          sessionId: "s4",
          participantId: "ghost"
        })
      )
    ).rejects.toThrow(/Unknown agent id/);
  });

  it("persists raw agent output to disk when the JSON parser can't recover", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-delegate-raw-"));
    const script = join(root, "broken-agent.mjs");

    // A minimal "agent" that emits structurally broken JSON. Repair
    // cannot rescue it (unknown tokens, no quotes to escape), so the
    // delegate's catch path MUST persist the raw stdout for debugging.
    await writeFile(
      script,
      [
        'import process from "node:process";',
        'let stdin = "";',
        "for await (const chunk of process.stdin) stdin += chunk;",
        "process.stdout.write('{bogus literal nonsense}');"
      ].join("\n"),
      "utf8"
    );

    const loadedConfig = {
      configPath: join(root, "argue.config.json"),
      configDir: root,
      config: {
        schemaVersion: 1 as const,
        providers: {
          brokenProvider: {
            type: "cli" as const,
            cliType: "generic" as const,
            command: process.execPath,
            args: [script],
            env: {},
            models: {
              fake: {}
            }
          }
        },
        agents: [
          { id: "broken-agent", provider: "brokenProvider", model: "fake" },
          { id: "broken-agent-2", provider: "brokenProvider", model: "fake" }
        ]
      }
    };

    const plan = resolveRunPlan({
      loadedConfig,
      runInput: {},
      overrides: {
        requestId: "req-raw-dump",
        task: "check raw dump",
        jsonlPath: join(root, "run", "events.jsonl"),
        resultPath: join(root, "run", "result.json"),
        summaryPath: join(root, "run", "summary.md")
      }
    });

    const delegate = await createTaskDelegate({ loadedConfig, plan });

    const dispatch = await delegate.dispatch(
      makeRoundTask({
        requestId: "req-raw-dump",
        sessionId: "s-raw",
        participantId: "broken-agent"
      })
    );

    const result = await delegate.awaitResult(dispatch.taskId, 10_000);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid JSON output|JSON/);

    // The delegate should have written a raw dump file alongside the
    // other run artefacts, encoding participant / phase / round in the
    // filename so parallel failures don't clobber each other.
    const runDir = join(root, "run");
    const entries = await readdir(runDir);
    const dumpFile = entries.find((name) => name.startsWith("raw-error-broken-agent-initial-0"));
    expect(dumpFile, `expected raw-error dump file in ${runDir}, got: ${entries.join(", ")}`).toBeTruthy();

    const dumpContent = await readFile(join(runDir, dumpFile as string), "utf8");
    expect(dumpContent).toContain("bogus literal nonsense");
    expect(dumpContent).toContain("phase: initial");
    expect(dumpContent).toContain("round: 0");
    expect(dumpContent).toContain("participantId: broken-agent");
    expect(dumpContent).toContain("requestId: req-raw-dump");
  });

  it("throws on unknown model in agent catalog", async () => {
    const loadedConfig = {
      configPath: "/tmp/argue.config.json",
      configDir: "/tmp",
      config: {
        schemaVersion: 1 as const,
        providers: {
          mock1: {
            type: "mock" as const,
            models: {
              fake: {}
            }
          }
        },
        agents: [
          { id: "a1", provider: "mock1", model: "missing" },
          { id: "a2", provider: "mock1", model: "fake" }
        ]
      }
    };

    const plan = resolveRunPlan({
      loadedConfig: {
        ...loadedConfig,
        config: {
          ...loadedConfig.config,
          agents: [
            { id: "a1", provider: "mock1", model: "fake" },
            { id: "a2", provider: "mock1", model: "fake" }
          ]
        }
      },
      runInput: {},
      overrides: { requestId: "r", task: "t" }
    });

    await expect(createTaskDelegate({ loadedConfig, plan })).rejects.toThrow(/Unknown model/);
  });
});

function makeRoundTask(args: { requestId: string; sessionId: string; participantId: string }): AgentTaskInput {
  return {
    kind: "round",
    sessionId: args.sessionId,
    requestId: args.requestId,
    participantId: args.participantId,
    phase: "initial",
    round: 0,
    prompt: "p",
    claimCatalog: []
  };
}

function makeLoadedConfig(options: { delayMs: number; timeoutMs?: number }) {
  return {
    configPath: "/tmp/argue.config.json",
    configDir: "/tmp",
    config: {
      schemaVersion: 1 as const,
      providers: {
        mock1: {
          type: "mock" as const,
          defaultBehavior: {
            behavior: "deterministic" as const,
            delayMs: options.delayMs
          },
          models: {
            fake: {}
          }
        }
      },
      agents: [
        { id: "a1", provider: "mock1", model: "fake", timeoutMs: options.timeoutMs },
        { id: "a2", provider: "mock1", model: "fake" }
      ]
    }
  };
}
