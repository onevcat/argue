import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTaskInput } from "@onevcat/argue";
import { describe, expect, it, vi } from "vitest";
import { createCliRunner } from "../src/runtime/cli.js";

function makeRoundTask(): AgentTaskInput {
  return {
    kind: "round",
    sessionId: "s1",
    requestId: "req-1",
    participantId: "a1",
    phase: "initial",
    round: 0,
    prompt: "p",
    claimCatalog: []
  };
}

const agent = {
  id: "a1",
  provider: "cli",
  model: "fake",
  providerName: "cli",
  providerConfig: {
    type: "cli",
    cliType: "generic",
    command: process.execPath,
    models: {
      fake: {}
    }
  },
  modelConfig: {},
  providerModel: "fake",
  role: "role-a1"
};

describe("createCliRunner", () => {
  it("supports generic mode with stdin envelope and template rendering", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-runner-generic-"));
    const script = join(root, "runner.mjs");

    await writeFile(
      script,
      `
import process from "node:process";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const envelope = JSON.parse(stdin);
const output = {
  fullResponse: String(process.argv[2]) + ":" + String(process.env.ARG_TEMPLATE),
  summary: envelope.task.prompt,
  taskTitle: "generic cli title",
  extractedClaims: [],
  judgements: []
};
process.stdout.write(JSON.stringify(output));
`,
      "utf8"
    );

    const runner = createCliRunner({
      type: "cli",
      cliType: "generic",
      command: process.execPath,
      args: [script, "--who={participantId}:{phase}:{round}"],
      env: {
        ARG_TEMPLATE: "{requestId}:{participantId}:{phase}:{round}:{taskKind}:{providerModel}:{agentId}:{role}"
      },
      models: {
        fake: {}
      }
    });

    const result = await runner.runTask({
      task: makeRoundTask(),
      agent
    });

    expect(result).toEqual({
      kind: "round",
      output: expect.objectContaining({
        participantId: "a1",
        phase: "initial",
        round: 0,
        summary: "p",
        fullResponse: "--who=a1:initial:0:req-1:a1:initial:0:round:fake:a1:role-a1"
      })
    });
  });

  it("passes reasoning through generic envelope and prefers agent override", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-generic-reasoning-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "generic",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const overridden = await runner.runTask({
      task: makeRoundTask(),
      agent: {
        ...agent,
        reasoning: "high",
        modelConfig: { reasoning: "low" }
      }
    });

    const overriddenEnvelope = JSON.parse(
      getArgvAndStdin(overridden as { kind: string; output: { fullResponse: string } }).stdin
    ) as {
      agent: { reasoning?: string };
    };
    expect(overriddenEnvelope.agent.reasoning).toBe("high");

    const inherited = await runner.runTask({
      task: makeRoundTask(),
      agent: {
        ...agent,
        modelConfig: { reasoning: "low" }
      }
    });

    const inheritedEnvelope = JSON.parse(
      getArgvAndStdin(inherited as { kind: string; output: { fullResponse: string } }).stdin
    ) as {
      agent: { reasoning?: string };
    };
    expect(inheritedEnvelope.agent.reasoning).toBe("low");
  });

  it("passes --session-id for claude cliType when metadata has participantSessionKey", async () => {
    const script = await createArgvEchoScript("argue-cli-runner-session-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "claude",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const task = {
      ...makeRoundTask(),
      metadata: { participantSessionKey: "argue:sess-1:a1" }
    };

    const result = await runner.runTask({ task, agent });
    const argv = getArgv(result as { kind: string; output: { fullResponse: string } });

    expect(argv).toContain("--session-id");
    const sessionIdx = argv.indexOf("--session-id");
    const sessionId = argv[sessionIdx + 1]!;
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(argv).not.toContain("--no-session-persistence");
  });

  it("uses --resume with the same session id on subsequent claude calls", async () => {
    const script = await createArgvEchoScript("argue-cli-runner-resume-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "claude",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const firstTask = {
      ...makeRoundTask(),
      metadata: { participantSessionKey: "argue:sess-1:a1" }
    };
    const secondTask = {
      ...makeRoundTask(),
      phase: "initial" as const,
      round: 1,
      metadata: { participantSessionKey: "argue:sess-1:a1" }
    };

    const first = await runner.runTask({ task: firstTask, agent });
    const second = await runner.runTask({ task: secondTask, agent });

    const firstArgv = getArgv(first as { kind: string; output: { fullResponse: string } });
    const secondArgv = getArgv(second as { kind: string; output: { fullResponse: string } });

    expect(firstArgv).toContain("--session-id");
    expect(firstArgv).not.toContain("--resume");

    const firstSessionId = firstArgv[firstArgv.indexOf("--session-id") + 1]!;

    expect(secondArgv).toContain("--resume");
    expect(secondArgv).not.toContain("--session-id");
    expect(secondArgv).not.toContain("--no-session-persistence");

    const resumedSessionId = secondArgv[secondArgv.indexOf("--resume") + 1]!;
    expect(resumedSessionId).toBe(firstSessionId);
  });

  it("uses --no-session-persistence when session metadata is missing", async () => {
    const script = await createArgvEchoScript("argue-cli-runner-nosession-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "claude",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const first = await runner.runTask({ task: makeRoundTask(), agent });
    const second = await runner.runTask({
      task: {
        ...makeRoundTask(),
        phase: "initial",
        round: 1
      },
      agent
    });

    const firstArgv = getArgv(first as { kind: string; output: { fullResponse: string } });
    const secondArgv = getArgv(second as { kind: string; output: { fullResponse: string } });

    for (const argv of [firstArgv, secondArgv]) {
      expect(argv).toContain("--no-session-persistence");
      expect(argv).not.toContain("--session-id");
      expect(argv).not.toContain("--resume");
    }
  });

  it("passes reasoning to claude via --effort and prefers agent override", async () => {
    const script = await createArgvEchoScript("argue-cli-runner-claude-reasoning-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "claude",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const result = await runner.runTask({
      task: makeRoundTask(),
      agent: {
        ...agent,
        reasoning: "high",
        modelConfig: { reasoning: "low" }
      }
    });

    const argv = getArgv(result as { kind: string; output: { fullResponse: string } });
    expect(argv).toContain("--effort");
    expect(argv[argv.indexOf("--effort") + 1]).toBe("high");
  });

  it("prepends codex base args before custom args", async () => {
    const script = await createArgvEchoScript("argue-cli-runner-codex-args-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "codex",
      command: script,
      args: ["--sandbox", "danger-full-access"],
      models: {
        fake: {}
      }
    });

    const result = await runner.runTask({
      task: makeRoundTask(),
      agent
    });

    const argv = getArgv(result as { kind: string; output: { fullResponse: string } });

    const execIndex = argv.indexOf("exec");
    const modelFlagIndex = argv.indexOf("-m");
    const fullAutoIndex = argv.indexOf("--full-auto");
    const colorIndex = argv.indexOf("--color");
    const sandboxIndex = argv.indexOf("--sandbox");

    expect(execIndex).toBeGreaterThan(0);
    expect(modelFlagIndex).toBeGreaterThan(execIndex);
    expect(argv[modelFlagIndex + 1]).toBe("fake");
    expect(fullAutoIndex).toBeGreaterThan(modelFlagIndex);
    expect(colorIndex).toBeGreaterThan(fullAutoIndex);
    expect(argv[colorIndex + 1]).toBe("never");
    expect(sandboxIndex).toBeGreaterThan(colorIndex);
    expect(argv[sandboxIndex + 1]).toBe("danger-full-access");
  });

  it("passes reasoning to codex via model_reasoning_effort config override", async () => {
    const script = await createArgvEchoScript("argue-cli-runner-codex-reasoning-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "codex",
      command: script,
      args: [],
      models: {
        fake: {}
      }
    });

    const result = await runner.runTask({
      task: makeRoundTask(),
      agent: {
        ...agent,
        modelConfig: { reasoning: "minimal" }
      }
    });

    const argv = getArgv(result as { kind: string; output: { fullResponse: string } });
    expect(argv).toContain("-c");
    const configOverride = argv[argv.indexOf("-c") + 1];
    expect(configOverride).toBe("model_reasoning_effort=minimal");
  });

  it("warns once for unsupported cliType reasoning and keeps running", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-gemini-reasoning-warning-");
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      const runner = createCliRunner({
        type: "cli",
        cliType: "gemini",
        command: script,
        args: [],
        models: { fake: {} }
      });

      const customAgent = {
        ...agent,
        modelConfig: { reasoning: "high" }
      };

      await runner.runTask({ task: makeRoundTask(), agent: customAgent });
      await runner.runTask({
        task: { ...makeRoundTask(), round: 1 },
        agent: customAgent
      });

      const warningCalls = writeSpy.mock.calls.filter((call) =>
        String(call[0]).includes("does not have a verified reasoning flag")
      );
      expect(warningCalls).toHaveLength(1);
      expect(String(warningCalls[0]?.[0])).toContain("cliType 'gemini'");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("builds copilot base args with prompt in args and --yolo", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-copilot-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "copilot",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const result = await runner.runTask({ task: makeRoundTask(), agent });
    const { argv, stdin } = getArgvAndStdin(result as { kind: string; output: { fullResponse: string } });

    expect(argv).toContain("-p");
    const pIdx = argv.indexOf("-p");
    const promptValue = argv[pIdx + 1]!;
    expect(promptValue).toContain("argue CLI host");

    expect(argv).toContain("--yolo");
    expect(argv).toContain("--model");
    expect(argv[argv.indexOf("--model") + 1]).toBe("fake");

    expect(stdin).toBe("");
  });

  it("builds gemini base args with stdin prompt and --approval-mode yolo", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-gemini-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "gemini",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const result = await runner.runTask({ task: makeRoundTask(), agent });
    const { argv, stdin } = getArgvAndStdin(result as { kind: string; output: { fullResponse: string } });

    expect(argv).toContain("--approval-mode");
    expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("yolo");
    expect(argv).toContain("-m");
    expect(argv[argv.indexOf("-m") + 1]).toBe("fake");

    expect(argv).not.toContain("-p");
    expect(stdin).toContain("argue CLI host");
  });

  it("builds pi base args with stdin prompt and session file path", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-pi-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "pi",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const task = {
      ...makeRoundTask(),
      metadata: { participantSessionKey: "argue:sess-1:a1" }
    };

    const result = await runner.runTask({ task, agent });
    const { argv, stdin } = getArgvAndStdin(result as { kind: string; output: { fullResponse: string } });

    expect(argv).toContain("--model");
    expect(argv[argv.indexOf("--model") + 1]).toBe("fake");
    expect(argv).toContain("--session");
    const sessionPath = argv[argv.indexOf("--session") + 1]!;
    expect(sessionPath).toMatch(/argue-pi-[0-9a-f-]+$/);

    expect(stdin).toContain("argue CLI host");
  });

  it("pi uses same session path across calls", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-pi-resume-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "pi",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const task = {
      ...makeRoundTask(),
      metadata: { participantSessionKey: "argue:sess-1:a1" }
    };

    const first = await runner.runTask({ task, agent });
    const second = await runner.runTask({ task: { ...task, round: 1 }, agent });

    const firstArgv = getArgvAndStdin(first as { kind: string; output: { fullResponse: string } }).argv;
    const secondArgv = getArgvAndStdin(second as { kind: string; output: { fullResponse: string } }).argv;

    const firstPath = firstArgv[firstArgv.indexOf("--session") + 1]!;
    const secondPath = secondArgv[secondArgv.indexOf("--session") + 1]!;
    expect(firstPath).toBe(secondPath);
  });

  it("pi omits --session when no session metadata", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-pi-nosession-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "pi",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const result = await runner.runTask({ task: makeRoundTask(), agent });
    const { argv } = getArgvAndStdin(result as { kind: string; output: { fullResponse: string } });

    expect(argv).not.toContain("--session");
    expect(argv).toContain("--model");
  });

  it("builds opencode base args with prompt as positional arg", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-opencode-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "opencode",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const result = await runner.runTask({ task: makeRoundTask(), agent });
    const { argv, stdin } = getArgvAndStdin(result as { kind: string; output: { fullResponse: string } });

    expect(argv).toContain("run");
    const runIdx = argv.indexOf("run");
    const promptValue = argv[runIdx + 1]!;
    expect(promptValue).toContain("argue CLI host");

    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).toContain("-m");
    expect(argv[argv.indexOf("-m") + 1]).toBe("fake");

    expect(stdin).toBe("");
  });

  it("builds droid base args with exec subcommand and stdin prompt", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-droid-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "droid",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const result = await runner.runTask({ task: makeRoundTask(), agent });
    const { argv, stdin } = getArgvAndStdin(result as { kind: string; output: { fullResponse: string } });

    expect(argv).toContain("exec");
    expect(argv).toContain("--auto");
    expect(argv[argv.indexOf("--auto") + 1]).toBe("high");
    expect(argv).toContain("-m");
    expect(argv[argv.indexOf("-m") + 1]).toBe("fake");

    expect(stdin).toContain("argue CLI host");
  });

  it("builds amp base args with -x prompt and no model flag", async () => {
    const script = await createArgvAndStdinEchoScript("argue-cli-runner-amp-");

    const runner = createCliRunner({
      type: "cli",
      cliType: "amp",
      command: script,
      args: [],
      models: { fake: {} }
    });

    const result = await runner.runTask({ task: makeRoundTask(), agent });
    const { argv, stdin } = getArgvAndStdin(result as { kind: string; output: { fullResponse: string } });

    expect(argv).toContain("-x");
    const xIdx = argv.indexOf("-x");
    const promptValue = argv[xIdx + 1]!;
    expect(promptValue).toContain("argue CLI host");

    expect(argv).toContain("--dangerously-allow-all");
    expect(argv).not.toContain("--model");
    expect(argv).not.toContain("-m");

    expect(stdin).toBe("");
  });

  it("parses fenced json output in codex mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-runner-codex-"));
    const script = join(root, "runner.mjs");

    await writeFile(
      script,
      `#!/usr/bin/env node
const fence = String.fromCharCode(96).repeat(3);
process.stdout.write(fence + 'json\\n' + JSON.stringify({
  fullResponse: "fenced",
  summary: "sum",
  taskTitle: "demo title",
  extractedClaims: [],
  judgements: []
}) + '\\n' + fence + '\\n');
`,
      { mode: 0o755 }
    );

    const runner = createCliRunner({
      type: "cli",
      cliType: "codex",
      command: script,
      args: [],
      models: {
        fake: {}
      }
    });

    const result = await runner.runTask({
      task: makeRoundTask(),
      agent
    });

    expect(result).toEqual({
      kind: "round",
      output: expect.objectContaining({
        participantId: "a1",
        phase: "initial",
        round: 0,
        fullResponse: "fenced"
      })
    });
  });
});

function getArgv(result: { output: { fullResponse: string } }): string[] {
  return JSON.parse(result.output.fullResponse) as string[];
}

function getArgvAndStdin(result: { output: { fullResponse: string } }): { argv: string[]; stdin: string } {
  return JSON.parse(result.output.fullResponse) as { argv: string[]; stdin: string };
}

async function createArgvEchoScript(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const script = join(root, "runner.mjs");

  await writeFile(
    script,
    `#!/usr/bin/env node
import process from "node:process";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
process.stdout.write(JSON.stringify({
  fullResponse: JSON.stringify(process.argv),
  summary: "ok",
  taskTitle: "demo title",
  extractedClaims: [],
  judgements: []
}));
`,
    { mode: 0o755 }
  );

  return script;
}

async function createArgvAndStdinEchoScript(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const script = join(root, "runner.mjs");

  await writeFile(
    script,
    `#!/usr/bin/env node
import process from "node:process";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
process.stdout.write(JSON.stringify({
  fullResponse: JSON.stringify({ argv: process.argv, stdin }),
  summary: "ok",
  taskTitle: "demo title",
  extractedClaims: [],
  judgements: []
}));
`,
    { mode: 0o755 }
  );

  return script;
}
