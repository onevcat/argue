import type { AgentTaskInput } from "argue";
import { describe, expect, it } from "vitest";
import { createMockRunner } from "../src/runtime/mock.js";

const agent = {
  id: "a1",
  provider: "mock",
  model: "fake",
  providerName: "mock",
  providerConfig: {
    type: "mock",
    models: {
      fake: {}
    }
  },
  modelConfig: {},
  providerModel: "fake",
  role: "architect"
};

function makeRoundTask(phase: "initial" | "debate" | "final_vote", participantId: string = "a1"): AgentTaskInput {
  return {
    kind: "round",
    sessionId: "s1",
    requestId: "r1",
    participantId,
    phase,
    round: 0,
    prompt: "p",
    claimCatalog: [
      {
        claimId: "c1",
        title: "C1",
        statement: "claim",
        proposedBy: ["a1"],
        status: "active"
      }
    ]
  };
}

function makeReportTask(): AgentTaskInput {
  return {
    kind: "report",
    sessionId: "s-report",
    requestId: "r-report",
    participantId: "a1",
    prompt: "report",
    reportInput: {
      status: "consensus",
      representative: {
        participantId: "a1",
        speech: "speech",
        score: 90
      },
      finalClaims: [],
      claimResolutions: [],
      scoreboard: [],
      rounds: []
    }
  };
}

function makeActionTask(): AgentTaskInput {
  return {
    kind: "action",
    sessionId: "s-action",
    requestId: "r-action",
    participantId: "a1",
    prompt: "act",
    argueResult: {
      status: "consensus",
      finalSummary: "summary",
      representativeSpeech: "speech",
      claims: [],
      claimResolutions: [],
      scoreboard: []
    }
  };
}

describe("createMockRunner", () => {
  it("returns deterministic output by default", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      }
    });

    const output = await runner.runTask({
      task: makeRoundTask("initial"),
      agent
    });

    expect(output).toEqual(
      expect.objectContaining({
        summary: expect.stringContaining("a1")
      })
    );
  });

  it("supports malformed behavior override", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      },
      participants: {
        a1: {
          debate: {
            behavior: "malformed"
          }
        }
      }
    });

    const output = await runner.runTask({
      task: makeRoundTask("debate"),
      agent
    });

    expect(output).toEqual({ malformed: true });
  });

  it("throws for error behavior with fallback message when no custom error", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      },
      participants: {
        a1: {
          final_vote: {
            behavior: "error"
          }
        }
      }
    });

    await expect(
      runner.runTask({
        task: makeRoundTask("final_vote"),
        agent
      })
    ).rejects.toThrow("Mock error from a1");
  });

  it("uses task.participantId scenario when agent.id does not match", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      },
      participants: {
        ghost: {
          debate: {
            behavior: "malformed"
          }
        }
      }
    });

    const output = await runner.runTask({
      task: makeRoundTask("debate", "ghost"),
      agent: {
        ...agent,
        id: "another-agent"
      }
    });

    expect(output).toEqual({ malformed: true });
  });

  it("returns deterministic report output", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      }
    });

    const output = await runner.runTask({
      task: makeReportTask(),
      agent
    });

    expect(output).toEqual(
      expect.objectContaining({
        mode: "representative",
        traceIncluded: false,
        finalSummary: expect.stringContaining("r-report")
      })
    );
  });

  it("returns deterministic action output", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      }
    });

    const output = await runner.runTask({
      task: makeActionTask(),
      agent
    });

    expect(output).toEqual({
      fullResponse: "Action completed by a1.",
      summary: "Action completed by a1."
    });
  });

  it("supports timeout behavior and rejects after abort", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      },
      participants: {
        a1: {
          debate: {
            behavior: "timeout"
          }
        }
      }
    });

    const controller = new AbortController();
    const pending = runner.runTask({
      task: makeRoundTask("debate"),
      agent,
      abortSignal: controller.signal
    });

    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });

  it("rejects when delayed task is aborted", async () => {
    const runner = createMockRunner({
      type: "mock",
      models: {
        fake: {}
      },
      defaultBehavior: {
        behavior: "deterministic",
        delayMs: 50
      }
    });

    const controller = new AbortController();
    const pending = runner.runTask({
      task: makeRoundTask("initial"),
      agent,
      abortSignal: controller.signal
    });

    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
  });
});
