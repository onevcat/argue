import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

describe("argue-cli runtime e2e", () => {
  const envKeys = ["ARGUE_TEST_OPENAI_KEY", "ARGUE_TEST_ANTHROPIC_KEY"] as const;
  const originalEnv = new Map<string, string | undefined>(
    envKeys.map((key) => [key, process.env[key]])
  );

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

    const result = await runCli(
      [
        "run",
        "--config", configPath,
        "--request-id", "mock-e2e",
        "--topic", "Mock topic",
        "--objective", "Mock objective"
      ],
      {
        log: (msg: string) => logs.push(msg),
        error: (msg: string) => errors.push(msg)
      }
    );

    expect(result.ok).toBe(true);
    expect(errors).toHaveLength(0);
    expect(logs.some((line) => line.includes("run completed"))).toBe(true);

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

    const result = await runCli(
      [
        "run",
        "--config", configPath,
        "--request-id", "mock-timeout",
        "--topic", "Timeout topic",
        "--objective", "Timeout objective",
        "--per-task-timeout-ms", "1000",
        "--per-round-timeout-ms", "1000"
      ]
    );

    expect(result.ok).toBe(true);

    const resultJson = JSON.parse(await readFile(join(root, "out", "mock-timeout.result.json"), "utf8"));
    expect(resultJson.status).toBe("consensus");
    expect(resultJson.eliminations).toContainEqual(expect.objectContaining({
      participantId: "a3",
      reason: "timeout"
    }));
  });

  it("runs codex-style CLI providers and extracts fenced JSON output", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-cli-"));
    const configPath = join(root, "argue.config.json");
    const scriptPath = join(root, "cli-runner.mjs");

    await writeFile(scriptPath, CLI_RUNNER_SCRIPT, "utf8");
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
          command: process.execPath,
          args: [scriptPath],
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

    const result = await runCli([
      "run",
      "--config", configPath,
      "--request-id", "cli-codex",
      "--topic", "CLI topic",
      "--objective", "CLI objective"
    ]);

    expect(result.ok).toBe(true);
    const resultJson = JSON.parse(await readFile(join(root, "out", "cli-codex.result.json"), "utf8"));
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

    const result = await runCli([
      "run",
      "--config", configPath,
      "--request-id", "sdk-e2e",
      "--topic", "SDK topic",
      "--objective", "SDK objective"
    ]);

    expect(result.ok).toBe(true);
    const resultJson = JSON.parse(await readFile(join(root, "out", "sdk-e2e.result.json"), "utf8"));
    expect(resultJson.status).toBe("consensus");
  });

  it("runs openai-compatible api providers through AI SDK", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-openai-"));
    const configPath = join(root, "argue.config.json");
    process.env.ARGUE_TEST_OPENAI_KEY = "openai-test-key";

    const server = await startJsonServer((req, res, body) => {
      expect(req.url).toBe("/v1/chat/completions");
      replyJson(res, openAIChatResponse(phaseFromBody(body)));
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
        "--config", configPath,
        "--request-id", "api-openai",
        "--topic", "OpenAI topic",
        "--objective", "OpenAI objective"
      ]);

      expect(result.ok).toBe(true);
      const resultJson = JSON.parse(await readFile(join(root, "out", "api-openai.result.json"), "utf8"));
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
      replyJson(res, anthropicMessageResponse(phaseFromBody(body)));
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
        "--config", configPath,
        "--request-id", "api-anthropic",
        "--topic", "Anthropic topic",
        "--objective", "Anthropic objective"
      ]);

      expect(result.ok).toBe(true);
      const resultJson = JSON.parse(await readFile(join(root, "out", "api-anthropic.result.json"), "utf8"));
      expect(resultJson.status).toBe("consensus");
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
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
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
  if (body.includes("\"phase\":\"final_vote\"") || body.includes("phase=final_vote")) {
    return "final_vote";
  }
  if (body.includes("\"phase\":\"debate\"") || body.includes("phase=debate")) {
    return "debate";
  }
  return "initial";
}

function replyJson(res: ServerResponse, value: unknown): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}

function openAIChatResponse(phase: "initial" | "debate" | "final_vote"): Record<string, unknown> {
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
          content: JSON.stringify(contentForPhase(phase))
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

function anthropicMessageResponse(phase: "initial" | "debate" | "final_vote"): Record<string, unknown> {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    model: "fake",
    content: [
      {
        type: "text",
        text: JSON.stringify(contentForPhase(phase))
      }
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: 1,
      output_tokens: 1
    }
  };
}

function contentForPhase(phase: "initial" | "debate" | "final_vote"): Record<string, unknown> {
  if (phase === "initial") {
    return {
      fullResponse: "Initial response",
      summary: "Initial summary",
      extractedClaims: [
        {
          claimId: "shared-claim",
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
      judgements: [
        {
          claimId: "shared-claim",
          stance: "agree",
          confidence: 0.9,
          rationale: "Agree"
        }
      ]
    };
  }

  return {
    fullResponse: "Final vote response",
    summary: "Final vote summary",
    judgements: [
      {
        claimId: "shared-claim",
        stance: "agree",
        confidence: 0.9,
        rationale: "Agree"
      }
    ],
    claimVotes: [
      {
        claimId: "shared-claim",
        vote: "accept",
        reason: "Accept"
      }
    ]
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
let payload;

if (phase === "initial") {
  payload = {
    fullResponse: "CLI initial response",
    summary: "CLI initial summary",
    extractedClaims: [
      { claimId: "shared-claim", title: "Shared claim", statement: "Shared statement", category: "pro" }
    ],
    judgements: []
  };
} else if (phase === "debate") {
  payload = {
    fullResponse: "CLI debate response",
    summary: "CLI debate summary",
    judgements: [
      { claimId: "shared-claim", stance: "agree", confidence: 0.9, rationale: "Agree" }
    ]
  };
} else {
  payload = {
    fullResponse: "CLI final vote response",
    summary: "CLI final vote summary",
    judgements: [
      { claimId: "shared-claim", stance: "agree", confidence: 0.9, rationale: "Agree" }
    ],
    claimVotes: [
      { claimId: "shared-claim", vote: "accept", reason: "Accept" }
    ]
  };
}

process.stdout.write("Here is the JSON you asked for.\\n\`\`\`json\\n" + JSON.stringify(payload) + "\\n\`\`\`\\n");
`;

const SDK_ADAPTER_SCRIPT = `
export function createArgueSdkAdapter() {
  return {
    async runTask({ task }) {
      if (task.kind === "report") {
        return {
          mode: "representative",
          traceIncluded: false,
          traceLevel: "compact",
          finalSummary: "SDK report summary",
          representativeSpeech: "SDK report speech"
        };
      }

      if (task.phase === "initial") {
        return {
          fullResponse: "SDK initial response",
          summary: "SDK initial summary",
          extractedClaims: [
            { claimId: "shared-claim", title: "Shared claim", statement: "Shared statement", category: "pro" }
          ],
          judgements: []
        };
      }

      if (task.phase === "debate") {
        return {
          fullResponse: "SDK debate response",
          summary: "SDK debate summary",
          judgements: [
            { claimId: "shared-claim", stance: "agree", confidence: 0.9, rationale: "Agree" }
          ]
        };
      }

      return {
        fullResponse: "SDK final vote response",
        summary: "SDK final vote summary",
        judgements: [
          { claimId: "shared-claim", stance: "agree", confidence: 0.9, rationale: "Agree" }
        ],
        claimVotes: [
          { claimId: "shared-claim", vote: "accept", reason: "Accept" }
        ]
      };
    }
  };
}
`;
