import { describe, expect, it } from "vitest";
import { ArgueEngine } from "../src/core/engine.js";
import type { AgentTaskResult } from "../src/contracts/task.js";
import type { ParticipantRoundOutput } from "../src/contracts/result.js";
import { StubAgentTaskDelegate } from "./helpers/stub-agent.js";

const PARTICIPANTS = ["onevclaw", "onevpaw", "onevtail"] as const;

function mkRoundOutput(input: {
  participantId: string;
  phase: "initial" | "debate" | "final_vote";
  round: number;
  stance?: "agree" | "disagree" | "revise";
  claimVotes?: Array<{ claimId: string; vote: "accept" | "reject"; reason?: string }>;
  extractedClaimId?: string;
}): ParticipantRoundOutput {
  const claimId = input.extractedClaimId ?? "c1";
  const judgements = [{
    claimId,
    stance: input.stance ?? "agree",
    confidence: 0.9,
    rationale: `${input.participantId} rationale ${input.phase} ${input.round}`
  }];

  if (input.phase === "initial") {
    return {
      participantId: input.participantId,
      phase: "initial",
      round: input.round,
      fullResponse: `${input.participantId}:${input.phase}:${input.round}`,
      extractedClaims: [{
        claimId,
        title: "Claim",
        statement: "Claim statement",
        category: "pro"
      }],
      judgements,
      summary: `${input.participantId} summary`
    };
  }

  if (input.phase === "debate") {
    return {
      participantId: input.participantId,
      phase: "debate",
      round: input.round,
      fullResponse: `${input.participantId}:${input.phase}:${input.round}`,
      judgements,
      summary: `${input.participantId} summary`
    };
  }

  return {
    participantId: input.participantId,
    phase: "final_vote",
    round: input.round,
    fullResponse: `${input.participantId}:${input.phase}:${input.round}`,
    judgements,
    claimVotes: input.claimVotes ?? [{ claimId, vote: "accept" }],
    summary: `${input.participantId} summary`
  };
}

function roundResult(output: ParticipantRoundOutput): AgentTaskResult {
  return {
    kind: "round",
    output
  };
}

describe("ArgueEngine M2", () => {
  it("uses effective voters as claim-consensus denominator", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult } | { type: "timeout" }> = {};

    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 1 }))
      };
      scenarios[`round:debate:2:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 2 }))
      };
    }

    scenarios["round:final_vote:3:onevclaw"] = {
      type: "success",
      output: roundResult(mkRoundOutput({
        participantId: "onevclaw",
        phase: "final_vote",
        round: 3,
        claimVotes: [{ claimId: "c1", vote: "accept" }]
      }))
    };
    scenarios["round:final_vote:3:onevpaw"] = {
      type: "success",
      output: roundResult(mkRoundOutput({
        participantId: "onevpaw",
        phase: "final_vote",
        round: 3,
        claimVotes: [{ claimId: "c1", vote: "accept" }]
      }))
    };
    scenarios["round:final_vote:3:onevtail"] = { type: "timeout" };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });

    const result = await engine.start({
      requestId: "req-effective-voters",
      topic: "Consensus denominator",
      objective: "Validate effective-voters denominator",
      participants: PARTICIPANTS.map((id) => ({ id })),
      participantsPolicy: { minParticipants: 2 },
      roundPolicy: { minRounds: 2, maxRounds: 3 },
      consensusPolicy: { threshold: 1 },
      waitingPolicy: {
        perTaskTimeoutMs: 1000,
        perRoundTimeoutMs: 1000
      }
    });

    expect(result.status).toBe("consensus");
    expect(result.claimResolutions[0]?.totalVoters).toBe(2);
    expect(result.eliminations).toContainEqual(expect.objectContaining({
      participantId: "onevtail",
      round: 3,
      reason: "timeout"
    }));
    expect(result.metrics.earlyStopTriggered).toBe(true);
  });

  it("falls back to builtin report when representative report task fails", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult } | { type: "fail"; error: string }> = {};

    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 1 }))
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2 }))
      };
    }

    scenarios["report:external-reporter"] = {
      type: "fail",
      error: "reporter unavailable"
    };

    const delegate = new StubAgentTaskDelegate(scenarios);
    const engine = new ArgueEngine({ taskDelegate: delegate });

    const result = await engine.start({
      requestId: "req-report-fallback",
      topic: "Report fallback",
      objective: "fallback to builtin when representative report fails",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      reportPolicy: {
        composer: "representative",
        representativeId: "external-reporter"
      }
    });

    const reportDispatch = delegate.dispatchCalls.find((x) => x.kind === "report");

    expect(reportDispatch?.kind).toBe("report");
    if (reportDispatch?.kind === "report") {
      expect(reportDispatch.sessionId).toContain(":report:");
      expect(reportDispatch.participantId).toBe("external-reporter");
      expect(reportDispatch.metadata?.separateSession).toBe(true);
    }

    expect(result.report.mode).toBe("builtin");
    expect(PARTICIPANTS).toContain(result.representative.participantId as (typeof PARTICIPANTS)[number]);
  });

  it("uses host-designated representative when designated participant is active", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {};

    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 1 }))
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2 }))
      };
    }

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });

    const result = await engine.start({
      requestId: "req-designated",
      topic: "Designated representative",
      objective: "choose host-designated active representative",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      reportPolicy: {
        composer: "builtin",
        representativeId: "onevpaw"
      }
    });

    expect(result.representative.participantId).toBe("onevpaw");
    expect(result.representative.reason).toBe("host-designated");
  });

  it("rejects removed waiting/report policy fields", async () => {
    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate({}) });

    await expect(engine.start({
      requestId: "req-invalid-fields",
      topic: "invalid",
      objective: "invalid",
      participants: [{ id: "a" }, { id: "b" }],
      waitingPolicy: {
        perTaskTimeoutMs: 1000,
        perRoundTimeoutMs: 1000,
        mode: "event-first"
      } as unknown as {
        perTaskTimeoutMs: number;
        perRoundTimeoutMs: number;
      }
    })).rejects.toThrow();

    await expect(engine.start({
      requestId: "req-invalid-report-fields",
      topic: "invalid",
      objective: "invalid",
      participants: [{ id: "a" }, { id: "b" }],
      reportPolicy: {
        composer: "builtin",
        maxReportChars: 1000
      } as unknown as {
        composer: "builtin";
      }
    })).rejects.toThrow();
  });
});
