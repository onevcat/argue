import { describe, expect, it } from "vitest";
import { ArgueEngine } from "../src/core/engine.js";
import type { ParticipantRoundOutput } from "../src/contracts/result.js";
import { StubAgentTaskDelegate, StubReportComposerDelegate } from "./helpers/stub-agent.js";

const PARTICIPANTS = ["onevclaw", "onevpaw", "onevtail"] as const;

function mkOutput(input: {
  participantId: string;
  phase: "initial" | "debate" | "final_vote";
  round: number;
  stance?: "agree" | "disagree" | "revise";
  confidence?: number;
  vote?: "accept" | "reject";
  summary?: string;
  selfScore?: number;
  revisedStatement?: string;
}): ParticipantRoundOutput {
  return {
    participantId: input.participantId,
    phase: input.phase,
    round: input.round,
    fullResponse: `${input.participantId}:${input.phase}:${input.round}`,
    extractedClaims: input.phase === "initial"
      ? [{ claimId: "c1", title: "Claim 1", statement: "Start from baseline", category: "pro" }]
      : undefined,
    judgements: [{
      claimId: "c1",
      stance: input.stance ?? "agree",
      confidence: input.confidence ?? 0.8,
      rationale: `${input.participantId} rationale ${input.phase} ${input.round}`,
      revisedStatement: input.revisedStatement
    }],
    vote: input.vote,
    selfScore: input.selfScore,
    summary: input.summary ?? `${input.participantId} summary ${input.phase} ${input.round}`
  };
}

class RecordingStore {
  private readonly sessions = new Map<string, Record<string, unknown>>();
  lastSessionId?: string;

  async save(session: unknown): Promise<void> {
    const record = session as Record<string, unknown>;
    this.lastSessionId = record.sessionId as string;
    this.sessions.set(this.lastSessionId, record);
  }

  async load(sessionId: string): Promise<Record<string, unknown> | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async update(sessionId: string, patch: unknown): Promise<void> {
    const current = this.sessions.get(sessionId) ?? {};
    this.sessions.set(sessionId, {
      ...current,
      ...(patch as Record<string, unknown>)
    });
  }
}

class RecordingObserver {
  readonly events: Array<{ type: string; payload?: Record<string, unknown> }> = [];

  async onEvent(event: { type: string; payload?: Record<string, unknown> }): Promise<void> {
    this.events.push(event);
  }
}

describe("ArgueEngine", () => {
  it("runs M1 happy-path with consensus", async () => {
    const scenarios: Record<string, { type: "success"; output: ParticipantRoundOutput }> = {};

    for (const participant of PARTICIPANTS) {
      scenarios[`initial:0:${participant}`] = {
        type: "success",
        output: mkOutput({ participantId: participant, phase: "initial", round: 0, selfScore: 70 })
      };

      for (let round = 1; round <= 3; round += 1) {
        scenarios[`debate:${round}:${participant}`] = {
          type: "success",
          output: mkOutput({
            participantId: participant,
            phase: "debate",
            round,
            stance: round === 2 && participant === "onevpaw" ? "revise" : "agree",
            revisedStatement: round === 2 && participant === "onevpaw" ? "Revised by onevpaw" : undefined,
            selfScore: participant === "onevpaw" ? 95 : 80
          })
        };
      }

      scenarios[`final_vote:4:${participant}`] = {
        type: "success",
        output: mkOutput({
          participantId: participant,
          phase: "final_vote",
          round: 4,
          vote: "accept",
          selfScore: participant === "onevpaw" ? 98 : 82
        })
      };
    }

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });

    const result = await engine.start({
      requestId: "req-1",
      topic: "How to roll out argue",
      objective: "Deliver an implementation plan",
      participants: PARTICIPANTS.map((id) => ({ id }))
    });

    expect(result.status).toBe("consensus");
    expect(result.rounds).toHaveLength(5); // initial + 3 debate + final_vote
    expect(result.representative.participantId).toBe("onevpaw");
    expect(result.report.mode).toBe("builtin");
    expect(result.metrics.totalTurns).toBe(15);
  });

  it("enforces minimum participants >= 2", async () => {
    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate({}) });

    await expect(
      engine.start({
        requestId: "req-invalid",
        topic: "single participant should fail",
        objective: "none",
        participants: [{ id: "only-one" }]
      })
    ).rejects.toThrow();
  });

  it("supports round timeout and still finalizes when minParticipants are satisfied", async () => {
    const scenarios: Record<string, { type: "success"; output: ParticipantRoundOutput } | { type: "timeout" }> = {};

    for (const participant of PARTICIPANTS) {
      scenarios[`initial:0:${participant}`] = {
        type: "success",
        output: mkOutput({ participantId: participant, phase: "initial", round: 0, selfScore: 70 })
      };
      for (let round = 1; round <= 3; round += 1) {
        scenarios[`debate:${round}:${participant}`] = {
          type: "success",
          output: mkOutput({ participantId: participant, phase: "debate", round, selfScore: 80 })
        };
      }
    }

    scenarios["final_vote:4:onevclaw"] = {
      type: "success",
      output: mkOutput({ participantId: "onevclaw", phase: "final_vote", round: 4, vote: "accept", selfScore: 80 })
    };
    scenarios["final_vote:4:onevpaw"] = {
      type: "success",
      output: mkOutput({ participantId: "onevpaw", phase: "final_vote", round: 4, vote: "accept", selfScore: 90 })
    };
    scenarios["final_vote:4:onevtail"] = { type: "timeout" };

    const delegate = new StubAgentTaskDelegate(scenarios);
    const engine = new ArgueEngine({ taskDelegate: delegate });

    const result = await engine.start({
      requestId: "req-timeout",
      topic: "Timeout tolerance",
      objective: "Keep going with two participants",
      participants: PARTICIPANTS.map((id) => ({ id })),
      waitingPolicy: {
        mode: "event-first",
        perTaskTimeoutMs: 1_000,
        perRoundTimeoutMs: 1_000,
        lateArrivalPolicy: "accept-if-before-finalize"
      }
    });

    expect(result.status).toBe("consensus");
    expect(result.metrics.waitTimeouts).toBeGreaterThanOrEqual(1);
    expect(delegate.canceledTaskIds.length).toBeGreaterThanOrEqual(1);
  });

  it("marks the session failed and emits Failed when orchestration throws", async () => {
    const store = new RecordingStore();
    const observer = new RecordingObserver();
    const engine = new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate({
        "initial:0:onevclaw": {
          type: "success",
          output: mkOutput({ participantId: "onevclaw", phase: "initial", round: 0 })
        }
      }),
      sessionStore: store,
      observer
    });

    await expect(
      engine.start({
        requestId: "req-failed",
        topic: "Failure path",
        objective: "Persist failed terminal state",
        participants: PARTICIPANTS.map((id) => ({ id }))
      })
    ).rejects.toThrow(/No scenario configured/);

    const session = await store.load(store.lastSessionId ?? "missing");
    expect(session?.state).toBe("failed");
    expect(session?.error).toMatchObject({
      code: "Error"
    });
    expect(String((session?.error as { message?: string } | undefined)?.message ?? "")).toContain("No scenario configured");
    expect(observer.events.at(-1)?.type).toBe("Failed");
  });

  it("includes deliberation trace when requested", async () => {
    const scenarios: Record<string, { type: "success"; output: ParticipantRoundOutput }> = {};

    for (const participant of PARTICIPANTS) {
      scenarios[`initial:0:${participant}`] = {
        type: "success",
        output: mkOutput({
          participantId: participant,
          phase: "initial",
          round: 0,
          stance: participant === "onevclaw" ? "disagree" : "agree"
        })
      };

      for (let round = 1; round <= 3; round += 1) {
        scenarios[`debate:${round}:${participant}`] = {
          type: "success",
          output: mkOutput({
            participantId: participant,
            phase: "debate",
            round,
            stance: participant === "onevclaw" && round === 1 ? "agree" : "agree"
          })
        };
      }

      scenarios[`final_vote:4:${participant}`] = {
        type: "success",
        output: mkOutput({ participantId: participant, phase: "final_vote", round: 4, vote: "accept" })
      };
    }

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });
    const result = await engine.start({
      requestId: "req-trace",
      topic: "Trace evolution",
      objective: "Show stance change",
      participants: PARTICIPANTS.map((id) => ({ id })),
      reportPolicy: {
        includeDeliberationTrace: true,
        traceLevel: "full",
        composer: "builtin"
      }
    });

    expect(result.report.traceIncluded).toBe(true);
    expect(result.report.opinionShiftTimeline?.length ?? 0).toBeGreaterThan(1);
    expect(
      result.report.opinionShiftTimeline?.some((x) => x.participantId === "onevclaw" && x.from === "disagree" && x.to === "agree")
    ).toBe(true);
  });

  it("uses delegate-agent report composer when requested", async () => {
    const scenarios: Record<string, { type: "success"; output: ParticipantRoundOutput }> = {};

    for (const participant of PARTICIPANTS) {
      scenarios[`initial:0:${participant}`] = {
        type: "success",
        output: mkOutput({ participantId: participant, phase: "initial", round: 0 })
      };
      for (let round = 1; round <= 3; round += 1) {
        scenarios[`debate:${round}:${participant}`] = {
          type: "success",
          output: mkOutput({ participantId: participant, phase: "debate", round })
        };
      }
      scenarios[`final_vote:4:${participant}`] = {
        type: "success",
        output: mkOutput({ participantId: participant, phase: "final_vote", round: 4, vote: "accept" })
      };
    }

    const reportDelegate = new StubReportComposerDelegate((input) => ({
      mode: "delegate-agent",
      traceIncluded: Boolean(input.policy.includeDeliberationTrace),
      traceLevel: input.policy.traceLevel ?? "compact",
      finalSummary: `delegate report for ${input.requestId}`,
      representativeSpeech: input.representative.speech
    }));

    const engine = new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate(scenarios),
      reportComposer: reportDelegate
    });

    const result = await engine.start({
      requestId: "req-delegate-report",
      topic: "Delegate report mode",
      objective: "use external composer",
      participants: PARTICIPANTS.map((id) => ({ id })),
      reportPolicy: {
        includeDeliberationTrace: true,
        traceLevel: "full",
        composer: "delegate-agent",
        reporterId: "reporter-1"
      }
    });

    expect(reportDelegate.called).toBe(1);
    expect(result.report.mode).toBe("delegate-agent");
    expect(result.report.finalSummary).toContain("delegate report");
  });
});
