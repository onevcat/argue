import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTaskInput } from "argue";
import { describe, expect, it } from "vitest";
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

    await writeFile(script, `
import process from "node:process";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const envelope = JSON.parse(stdin);
const output = {
  fullResponse: String(process.argv[2]) + ":" + String(process.env.ARG_TEMPLATE),
  summary: envelope.task.prompt,
  extractedClaims: [],
  judgements: []
};
process.stdout.write(JSON.stringify(output));
`, "utf8");

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

  it("parses fenced json output in codex mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-runner-codex-"));
    const script = join(root, "runner.mjs");

    await writeFile(script, `#!/usr/bin/env node
const fence = String.fromCharCode(96).repeat(3);
process.stdout.write(fence + 'json\\n' + JSON.stringify({
  fullResponse: "fenced",
  summary: "sum",
  extractedClaims: [],
  judgements: []
}) + '\\n' + fence + '\\n');
`, { mode: 0o755 });

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

async function createArgvEchoScript(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const script = join(root, "runner.mjs");

  await writeFile(script, `#!/usr/bin/env node
import process from "node:process";
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
process.stdout.write(JSON.stringify({
  fullResponse: JSON.stringify(process.argv),
  summary: "ok",
  extractedClaims: [],
  judgements: []
}));
`, { mode: 0o755 });

  return script;
}
