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

  it("parses fenced json output in codex mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-runner-codex-"));
    const script = join(root, "runner.mjs");

    await writeFile(script, `
const fence = String.fromCharCode(96).repeat(3);
process.stdout.write(fence + 'json\\n' + JSON.stringify({
  fullResponse: "fenced",
  summary: "sum",
  extractedClaims: [],
  judgements: []
}) + '\\n' + fence + '\\n');
`, "utf8");

    const runner = createCliRunner({
      type: "cli",
      cliType: "codex",
      command: process.execPath,
      args: [script],
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
