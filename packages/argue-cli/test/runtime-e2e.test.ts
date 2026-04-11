import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

describe("argue-cli runtime e2e", () => {
  const envKeys = ["ARGUE_TEST_OPENAI_KEY", "ARGUE_TEST_ANTHROPIC_KEY"] as const;
  const originalEnv = new Map<string, string | undefined>(envKeys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("runs end-to-end with mock provider and writes artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-mock-"));
    const configPath = join(root, "argue.config.json");

    await writeJson(configPath, {
      schemaVersion: 1,
      output: {
        jsonlPath: "./out/{requestId}.events.jsonl",
        resultPath: "./out/{requestId}.result.json",
        summaryPath: "./out/{requestId}.summary.md"
      },
      defaults: {
        defaultAgents: ["a1", "a2", "a3"],
        minRounds: 1,
        maxRounds: 1,
        composer: "representative",
        representativeId: "reporter"
      },
      providers: {
        mock: {
          type: "mock",
          models: {
            fake: {}
          },
          participants: {
            reporter: {
              report: {
                behavior: "malformed"
              }
            }
          }
        }
      },
      agents: [
        { id: "a1", provider: "mock", model: "fake", role: "architect" },
        { id: "a2", provider: "mock", model: "fake", role: "bughunter" },
        { id: "a3", provider: "mock", model: "fake", role: "critic" },
        { id: "reporter", provider: "mock", model: "fake", role: "reporter" }
      ]
    });

    const logs: string[] = [];
    const errors: string[] = [];

    const result = await runCli(["run", "--config", configPath, "--request-id", "mock-e2e", "--task", "Mock topic"], {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg)
    });

    expect(result.ok).toBe(true);
    expect(errors).toHaveLength(0);
    expect(logs.some((line) => line.includes("result:"))).toBe(true);

    const resultJson = JSON.parse(await readFile(join(root, "out", "mock-e2e.result.json"), "utf8"));
    const summary = await readFile(join(root, "out", "mock-e2e.summary.md"), "utf8");
    const jsonl = await readFile(join(root, "out", "mock-e2e.events.jsonl"), "utf8");

    expect(resultJson.status).toBe("consensus");
    expect(resultJson.report.mode).toBe("builtin");
    expect(summary).toContain("# argue run mock-e2e");
    expect(jsonl.trim().split("\n").length).toBeGreaterThan(3);
  });

  it("eliminates timed-out mock participants and still converges", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-timeout-"));
    const configPath = join(root, "argue.config.json");

    await writeJson(configPath, {
      schemaVersion: 1,
      defaults: {
        defaultAgents: ["a1", "a2", "a3"],
        minRounds: 1,
        maxRounds: 1
      },
      providers: {
        mock: {
          type: "mock",
          models: {
            fake: {}
          },
          participants: {
            a3: {
              final_vote: {
                behavior: "timeout"
              }
            }
          }
        }
      },
      agents: [
        { id: "a1", provider: "mock", model: "fake" },
        { id: "a2", provider: "mock", model: "fake" },
        { id: "a3", provider: "mock", model: "fake", timeoutMs: 20 }
      ]
    });

    const result = await runCli([
      "run",
      "--config",
      configPath,
      "--request-id",
      "mock-timeout",
      "--task",
      "Timeout topic",
      "--per-task-timeout-ms",
      "1000",
      "--per-round-timeout-ms",
      "1000"
    ]);

    expect(result.ok).toBe(true);

    const resultJson = JSON.parse(await readFile(join(root, "out", "mock-timeout", "result.json"), "utf8"));
    expect(resultJson.status).toBe("consensus");
    expect(resultJson.eliminations).toContainEqual(
      expect.objectContaining({
        participantId: "a3",
        reason: "timeout"
      })
    );
  });

  it("runs codex-style CLI providers and extracts fenced JSON output", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-cli-"));
    const configPath = join(root, "argue.config.json");
    const scriptPath = join(root, "cli-runner.mjs");

    await writeFile(scriptPath, `#!/usr/bin/env node\n${CLI_RUNNER_SCRIPT}`, { mode: 0o755 });
    await writeJson(configPath, {
      schemaVersion: 1,
      defaults: {
        defaultAgents: ["a1", "a2"],
        minRounds: 1,
        maxRounds: 1
      },
      providers: {
        codex: {
          type: "cli",
          cliType: "codex",
          command: scriptPath,
          models: {
            fake: {}
          }
        }
      },
      agents: [
        { id: "a1", provider: "codex", model: "fake" },
        { id: "a2", provider: "codex", model: "fake" }
      ]
    });

    const result = await runCli(["run", "--config", configPath, "--request-id", "cli-codex", "--task", "CLI topic"]);

    expect(result.ok).toBe(true);
    const resultJson = JSON.parse(await readFile(join(root, "out", "cli-codex", "result.json"), "utf8"));
    expect(resultJson.status).toBe("consensus");
  });

  it("runs sdk providers through adapter modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-sdk-"));
    const configPath = join(root, "argue.config.json");
    const adapterPath = join(root, "adapter.mjs");

    await writeFile(adapterPath, SDK_ADAPTER_SCRIPT, "utf8");
    await writeJson(configPath, {
      schemaVersion: 1,
      defaults: {
        defaultAgents: ["a1", "a2"],
        minRounds: 1,
        maxRounds: 1
      },
      providers: {
        sdk: {
          type: "sdk",
          adapter: "./adapter.mjs",
          env: {
            ARGUE_SDK_E2E: "sdk-ok"
          },
          models: {
            fake: {}
          }
        }
      },
      agents: [
        { id: "a1", provider: "sdk", model: "fake" },
        { id: "a2", provider: "sdk", model: "fake" }
      ]
    });

    const result = await runCli(["run", "--config", configPath, "--request-id", "sdk-e2e", "--task", "SDK topic"]);

    expect(result.ok).toBe(true);
    const resultJson = JSON.parse(await readFile(join(root, "out", "sdk-e2e", "result.json"), "utf8"));
    expect(resultJson.status).toBe("consensus");
    expect(resultJson.rounds[0]?.outputs[0]?.fullResponse).toContain("env=sdk-ok");
  });

  it("runs openai-compatible api providers through AI SDK", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-openai-"));
    const configPath = join(root, "argue.config.json");
    process.env.ARGUE_TEST_OPENAI_KEY = "openai-test-key";

    const server = await startJsonServer((req, res, body) => {
      expect(req.url).toBe("/v1/chat/completions");
      replyJson(res, openAIChatResponse(phaseFromBody(body), pidFromBody(body)));
    });

    try {
      await writeJson(configPath, {
        schemaVersion: 1,
        defaults: {
          defaultAgents: ["a1", "a2"],
          minRounds: 1,
          maxRounds: 1
        },
        providers: {
          api: {
            type: "api",
            protocol: "openai-compatible",
            baseUrl: `${server.baseUrl}/v1`,
            apiKeyEnv: "ARGUE_TEST_OPENAI_KEY",
            models: {
              fake: {}
            }
          }
        },
        agents: [
          { id: "a1", provider: "api", model: "fake" },
          { id: "a2", provider: "api", model: "fake" }
        ]
      });

      const result = await runCli([
        "run",
        "--config",
        configPath,
        "--request-id",
        "api-openai",
        "--task",
        "OpenAI topic"
      ]);

      expect(result.ok).toBe(true);
      const resultJson = JSON.parse(await readFile(join(root, "out", "api-openai", "result.json"), "utf8"));
      expect(resultJson.status).toBe("consensus");
    } finally {
      await server.close();
    }
  });

  it("runs anthropic-compatible api providers through AI SDK", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-anthropic-"));
    const configPath = join(root, "argue.config.json");
    process.env.ARGUE_TEST_ANTHROPIC_KEY = "anthropic-test-key";

    const server = await startJsonServer((req, res, body) => {
      expect(req.url).toBe("/v1/messages");
      replyJson(res, anthropicMessageResponse(phaseFromBody(body), pidFromBody(body)));
    });

    try {
      await writeJson(configPath, {
        schemaVersion: 1,
        defaults: {
          defaultAgents: ["a1", "a2"],
          minRounds: 1,
          maxRounds: 1
        },
        providers: {
          api: {
            type: "api",
            protocol: "anthropic-compatible",
            baseUrl: `${server.baseUrl}/v1`,
            apiKeyEnv: "ARGUE_TEST_ANTHROPIC_KEY",
            models: {
              fake: {}
            }
          }
        },
        agents: [
          { id: "a1", provider: "api", model: "fake" },
          { id: "a2", provider: "api", model: "fake" }
        ]
      });

      const result = await runCli([
        "run",
        "--config",
        configPath,
        "--request-id",
        "api-anthropic",
        "--task",
        "Anthropic topic"
      ]);

      expect(result.ok).toBe(true);
      const resultJson = JSON.parse(await readFile(join(root, "out", "api-anthropic", "result.json"), "utf8"));
      expect(resultJson.status).toBe("consensus");
    } finally {
      await server.close();
    }
  });

  it("accumulates messages across rounds for api session continuity", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-session-"));
    const configPath = join(root, "argue.config.json");
    process.env.ARGUE_TEST_OPENAI_KEY = "openai-test-key";

    const messageCounts: number[] = [];

    const server = await startJsonServer((req, res, body) => {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed.messages)) {
        messageCounts.push(parsed.messages.length);
      }
      replyJson(res, openAIChatResponse(phaseFromBody(body), pidFromBody(body)));
    });

    try {
      await writeJson(configPath, {
        schemaVersion: 1,
        defaults: {
          defaultAgents: ["a1", "a2"],
          minRounds: 1,
          maxRounds: 1
        },
        providers: {
          api: {
            type: "api",
            protocol: "openai-compatible",
            baseUrl: `${server.baseUrl}/v1`,
            apiKeyEnv: "ARGUE_TEST_OPENAI_KEY",
            models: { fake: {} }
          }
        },
        agents: [
          { id: "a1", provider: "api", model: "fake" },
          { id: "a2", provider: "api", model: "fake" }
        ]
      });

      const result = await runCli([
        "run",
        "--config",
        configPath,
        "--request-id",
        "session-test",
        "--task",
        "Session topic"
      ]);

      expect(result.ok).toBe(true);

      // 2 agents × 3 phases (initial, debate, final_vote) = 6 requests
      // Per agent: round 0 = 1 msg, round 1 = 3 msgs, round 2 = 5 msgs
      // (each round adds user + assistant, so +2 per round)
      const a1Counts = messageCounts.filter((_, i) => i % 2 === 0);
      const a2Counts = messageCounts.filter((_, i) => i % 2 === 1);

      // Each agent's message count should strictly increase across rounds
      for (const counts of [a1Counts, a2Counts]) {
        for (let i = 1; i < counts.length; i++) {
          expect(counts[i]).toBeGreaterThan(counts[i - 1]!);
        }
      }
    } finally {
      await server.close();
    }
  });
});

async function startJsonServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    handler(req, res, body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

function phaseFromBody(body: string): "initial" | "debate" | "final_vote" {
  if (body.includes('"phase":"final_vote"') || body.includes("phase=final_vote")) {
    return "final_vote";
  }
  if (body.includes('"phase":"debate"') || body.includes("phase=debate")) {
    return "debate";
  }
  return "initial";
}

function pidFromBody(body: string): string {
  try {
    // API providers: body is JSON with messages[].content containing the prompt
    const parsed = JSON.parse(body);
    let content = "";
    for (const m of parsed.messages ?? []) {
      if (typeof m.content === "string") {
        content += m.content;
      } else if (Array.isArray(m.content)) {
        // Anthropic-style: [{type:"text",text:"..."}]
        for (const block of m.content) {
          if (block.text) content += block.text;
        }
      }
    }
    // Also check the system field (Anthropic puts system prompt there)
    if (typeof parsed.system === "string") content += parsed.system;
    const match = content.match(/"participantId"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  } catch {
    // Non-JSON body (e.g., CLI stdin)
  }
  const match = body.match(/"participantId"\s*:\s*"([^"]+)"/);
  return match ? match[1] : "unknown";
}

function replyJson(res: ServerResponse, value: unknown): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

function openAIChatResponse(phase: "initial" | "debate" | "final_vote", pid: string): Record<string, unknown> {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "fake",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify(contentForPhase(phase, pid))
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2
    }
  };
}

function anthropicMessageResponse(phase: "initial" | "debate" | "final_vote", pid: string): Record<string, unknown> {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    model: "fake",
    content: [
      {
        type: "text",
        text: JSON.stringify(contentForPhase(phase, pid))
      }
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 1,
      output_tokens: 1
    }
  };
}

function contentForPhase(
  phase: "initial" | "debate" | "final_vote",
  _pid: string = "unknown",
  allPids: string[] = ["a1", "a2"]
): Record<string, unknown> {
  // Engine assigns IDs as {participantId}:0:0, so debate/final_vote
  // reference those IDs from the catalog.
  const allClaimIds = allPids.map((id) => `${id}:0:0`);

  if (phase === "initial") {
    return {
      fullResponse: "Initial response",
      summary: "Initial summary",
      extractedClaims: [
        {
          title: "Shared claim",
          statement: "Shared statement",
          category: "pro"
        }
      ],
      judgements: []
    };
  }

  if (phase === "debate") {
    return {
      fullResponse: "Debate response",
      summary: "Debate summary",
      judgements: allClaimIds.map((id) => ({
        claimId: id,
        stance: "agree",
        confidence: 0.9,
        rationale: "Agree"
      }))
    };
  }

  return {
    fullResponse: "Final vote response",
    summary: "Final vote summary",
    judgements: allClaimIds.map((id) => ({
      claimId: id,
      stance: "agree",
      confidence: 0.9,
      rationale: "Agree"
    })),
    claimVotes: allClaimIds.map((id) => ({
      claimId: id,
      vote: "accept",
      reason: "Accept"
    }))
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), "utf8");
}

const CLI_RUNNER_SCRIPT = `
import process from "node:process";

let stdin = "";
for await (const chunk of process.stdin) {
  stdin += chunk;
}

const phase = process.env.ARGUE_TASK_PHASE;
const pid = process.env.ARGUE_PARTICIPANT_ID;
const myClaimId = "claim-" + pid;
let payload;

function catalogFromStdin() {
  try {
    const m = stdin.match(/Task context JSON:\\n([\\s\\S]*?)(\\n\\nExpected output JSON schema:|$)/);
    if (m) {
      const task = JSON.parse(m[1]);
      return (task.claimCatalog || []).filter(c => c.status === "active" || !c.status);
    }
  } catch {}
  return [{ claimId: myClaimId }];
}

if (phase === "initial") {
  payload = {
    fullResponse: "CLI initial response",
    summary: "CLI initial summary",
    extractedClaims: [
      { title: "Claim from " + pid, statement: "Statement from " + pid, category: "pro" }
    ],
    judgements: []
  };
} else if (phase === "debate") {
  const catalog = catalogFromStdin();
  payload = {
    fullResponse: "CLI debate response",
    summary: "CLI debate summary",
    judgements: catalog.map(c => (
      { claimId: c.claimId, stance: "agree", confidence: 0.9, rationale: "Agree" }
    ))
  };
} else {
  const catalog = catalogFromStdin();
  payload = {
    fullResponse: "CLI final vote response",
    summary: "CLI final vote summary",
    judgements: catalog.map(c => (
      { claimId: c.claimId, stance: "agree", confidence: 0.9, rationale: "Agree" }
    )),
    claimVotes: catalog.map(c => (
      { claimId: c.claimId, vote: "accept", reason: "Accept" }
    ))
  };
}

process.stdout.write("Here is the JSON you asked for.\\n\\\`\\\`\\\`json\\n" + JSON.stringify(payload) + "\\n\\\`\\\`\\\`\\n");
`;

const SDK_ADAPTER_SCRIPT = `
export function createArgueSdkAdapter(args) {
  const envMark = args?.environment?.ARGUE_SDK_E2E ?? "missing";

  return {
    async runTask({ task, environment }) {
      const mark = environment?.ARGUE_SDK_E2E ?? envMark;

      if (task.kind === "report") {
        return {
          mode: "representative",
          traceIncluded: false,
          traceLevel: "compact",
          finalSummary: "SDK report summary",
          representativeSpeech: "SDK report speech"
        };
      }

      const myClaimId = "claim-" + task.participantId;
      const catalog = (task.claimCatalog || []).filter(c => c.status === "active" || !c.status);

      if (task.phase === "initial") {
        return {
          fullResponse:
            "SDK initial response env=" + mark,
          summary: "SDK initial summary",
          extractedClaims: [
            { title: "Claim from " + task.participantId, statement: "Statement from " + task.participantId, category: "pro" }
          ],
          judgements: []
        };
      }

      if (task.phase === "debate") {
        return {
          fullResponse: "SDK debate response",
          summary: "SDK debate summary",
          judgements: catalog.map(c => (
            { claimId: c.claimId, stance: "agree", confidence: 0.9, rationale: "Agree" }
          ))
        };
      }

      return {
        fullResponse: "SDK final vote response",
        summary: "SDK final vote summary",
        judgements: catalog.map(c => (
          { claimId: c.claimId, stance: "agree", confidence: 0.9, rationale: "Agree" }
        )),
        claimVotes: catalog.map(c => (
          { claimId: c.claimId, vote: "accept", reason: "Accept" }
        ))
      };
    }
  };
}
`;
