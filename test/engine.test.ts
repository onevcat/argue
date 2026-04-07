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
  extractedClaims?: Array<{
    claimId: string;
    title: string;
    statement: string;
    category?: "pro" | "con" | "risk" | "tradeoff" | "todo";
  }>;
  judgements?: Array<{
    claimId: string;
    stance: "agree" | "disagree" | "revise";
    confidence?: number;
    rationale?: string;
    revisedStatement?: string;
    mergesWith?: string;
  }>;
  summary?: string;
}): ParticipantRoundOutput {
  const claimId = input.extractedClaimId ?? "c1";
  const judgements = (input.judgements ?? [{
    claimId,
    stance: input.stance ?? "agree"
  }]).map((judgement) => ({
    claimId: judgement.claimId,
    stance: judgement.stance,
    confidence: judgement.confidence ?? 0.9,
    rationale: judgement.rationale ?? `${input.participantId} rationale ${input.phase} ${input.round}`,
    revisedStatement: judgement.revisedStatement,
    mergesWith: judgement.mergesWith
  }));
  const extractedClaims = input.extractedClaims ?? [{
    claimId,
    title: "Claim",
    statement: "Claim statement",
    category: "pro" as const
  }];
  const summary = input.summary ?? `${input.participantId} summary`;

  if (input.phase === "initial") {
    return {
      participantId: input.participantId,
      phase: "initial",
      round: input.round,
      fullResponse: `${input.participantId}:${input.phase}:${input.round}`,
      extractedClaims,
      judgements,
      summary
    };
  }

  if (input.phase === "debate") {
    return {
      participantId: input.participantId,
      phase: "debate",
      round: input.round,
      fullResponse: `${input.participantId}:${input.phase}:${input.round}`,
      judgements,
      summary
    };
  }

  return {
    participantId: input.participantId,
    phase: "final_vote",
    round: input.round,
    fullResponse: `${input.participantId}:${input.phase}:${input.round}`,
    judgements,
    claimVotes: input.claimVotes ?? [{ claimId, vote: "accept" }],
    summary
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

  it("runs full DI flow with absence, merge, oscillation, and representative report", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult } | { type: "timeout" }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "initial",
          round: 0,
          extractedClaims: [{ claimId: "c1", title: "C1", statement: "claim 1", category: "pro" }],
          judgements: [{ claimId: "c1", stance: "agree" }]
        }))
      },
      "round:initial:0:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "initial",
          round: 0,
          extractedClaims: [{ claimId: "c2", title: "C2", statement: "claim 2", category: "pro" }],
          judgements: [{ claimId: "c2", stance: "agree" }]
        }))
      },
      "round:initial:0:onevtail": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevtail",
          phase: "initial",
          round: 0,
          extractedClaims: [{ claimId: "c3", title: "C3", statement: "claim 3", category: "risk" }],
          judgements: [{ claimId: "c3", stance: "agree" }]
        }))
      },
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "debate",
          round: 1,
          judgements: [{
            claimId: "c2",
            stance: "revise",
            revisedStatement: "c2 is actually same as c1",
            mergesWith: "c1"
          }]
        }))
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "debate",
          round: 1,
          judgements: [{ claimId: "c1", stance: "disagree" }]
        }))
      },
      "round:debate:1:onevtail": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevtail",
          phase: "debate",
          round: 1,
          judgements: [{ claimId: "c1", stance: "agree" }]
        }))
      },
      "round:debate:2:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "debate",
          round: 2,
          judgements: [{ claimId: "c1", stance: "disagree" }]
        }))
      },
      "round:debate:2:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "debate",
          round: 2,
          judgements: [{ claimId: "c1", stance: "agree" }]
        }))
      },
      "round:debate:2:onevtail": {
        type: "timeout"
      },
      "round:debate:3:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "debate",
          round: 3,
          judgements: [{ claimId: "c1", stance: "agree" }]
        }))
      },
      "round:debate:3:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "debate",
          round: 3,
          judgements: [{ claimId: "c1", stance: "disagree" }]
        }))
      },
      "round:final_vote:4:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "final_vote",
          round: 4,
          judgements: [{ claimId: "c1", stance: "agree" }],
          claimVotes: [
            { claimId: "c1", vote: "accept" },
            { claimId: "c3", vote: "reject" }
          ]
        }))
      },
      "round:final_vote:4:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "final_vote",
          round: 4,
          judgements: [{ claimId: "c1", stance: "agree" }],
          claimVotes: [
            { claimId: "c1", vote: "accept" },
            { claimId: "c3", vote: "reject" }
          ]
        }))
      },
      "report:external-reporter": {
        type: "success",
        output: {
          kind: "report",
          output: {
            mode: "representative",
            traceIncluded: false,
            traceLevel: "compact",
            finalSummary: "external reporter summary",
            representativeSpeech: "external report speech"
          }
        }
      }
    };

    const delegate = new StubAgentTaskDelegate(scenarios);
    const engine = new ArgueEngine({ taskDelegate: delegate });

    const result = await engine.start({
      requestId: "req-full-di",
      topic: "full DI edge cases",
      objective: "run edge cases through full orchestration",
      participants: PARTICIPANTS.map((id) => ({ id })),
      participantsPolicy: { minParticipants: 2 },
      roundPolicy: { minRounds: 1, maxRounds: 3 },
      consensusPolicy: { threshold: 1 },
      reportPolicy: {
        composer: "representative",
        representativeId: "external-reporter"
      },
      waitingPolicy: {
        perTaskTimeoutMs: 1000,
        perRoundTimeoutMs: 1000
      }
    });

    expect(result.status).toBe("partial_consensus");
    expect(result.report.mode).toBe("representative");
    expect(delegate.dispatchCalls.some((x) => x.kind === "report")).toBe(true);

    expect(result.eliminations).toContainEqual(expect.objectContaining({
      participantId: "onevtail",
      round: 2,
      reason: "timeout"
    }));

    const c2 = result.finalClaims.find((claim) => claim.claimId === "c2");
    const c1 = result.finalClaims.find((claim) => claim.claimId === "c1");
    expect(c2?.status).toBe("merged");
    expect(c2?.mergedInto).toBe("c1");
    expect(c1?.proposedBy.sort()).toEqual(["onevclaw", "onevpaw"].sort());

    const c1Resolution = result.claimResolutions.find((item) => item.claimId === "c1");
    const c3Resolution = result.claimResolutions.find((item) => item.claimId === "c3");
    expect(c1Resolution?.status).toBe("resolved");
    expect(c3Resolution?.status).toBe("unresolved");

    expect(result.metrics.earlyStopTriggered).toBe(false);

    const onevpawDebateStances = result.rounds
      .filter((round) => round.round >= 1 && round.round <= 3)
      .map((round) => round.outputs.find((output) => output.participantId === "onevpaw")?.judgements[0]?.stance)
      .filter((x): x is "agree" | "disagree" | "revise" => typeof x === "string");
    expect(onevpawDebateStances).toEqual(["disagree", "agree", "disagree"]);
  });

  it("resolves chained claim merges to the earliest surviving claim", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "initial",
          round: 0,
          extractedClaims: [{ claimId: "c1", title: "C1", statement: "claim 1", category: "pro" }],
          judgements: [{ claimId: "c1", stance: "agree" }]
        }))
      },
      "round:initial:0:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "initial",
          round: 0,
          extractedClaims: [{ claimId: "c2", title: "C2", statement: "claim 2", category: "pro" }],
          judgements: [{ claimId: "c2", stance: "agree" }]
        }))
      },
      "round:initial:0:onevtail": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevtail",
          phase: "initial",
          round: 0,
          extractedClaims: [{ claimId: "c3", title: "C3", statement: "claim 3", category: "pro" }],
          judgements: [{ claimId: "c3", stance: "agree" }]
        }))
      },
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "debate",
          round: 1,
          judgements: [{ claimId: "c2", stance: "agree", mergesWith: "c1" }]
        }))
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "debate",
          round: 1,
          judgements: [{ claimId: "c3", stance: "agree", mergesWith: "c2" }]
        }))
      },
      "round:debate:1:onevtail": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevtail",
          phase: "debate",
          round: 1,
          judgements: [{ claimId: "c1", stance: "agree" }]
        }))
      },
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevclaw",
          phase: "final_vote",
          round: 2,
          claimVotes: [{ claimId: "c1", vote: "accept" }]
        }))
      },
      "round:final_vote:2:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevpaw",
          phase: "final_vote",
          round: 2,
          claimVotes: [{ claimId: "c1", vote: "accept" }]
        }))
      },
      "round:final_vote:2:onevtail": {
        type: "success",
        output: roundResult(mkRoundOutput({
          participantId: "onevtail",
          phase: "final_vote",
          round: 2,
          claimVotes: [{ claimId: "c1", vote: "accept" }]
        }))
      }
    };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });
    const result = await engine.start({
      requestId: "req-chain-merge",
      topic: "chain merge",
      objective: "merge c3 -> c2 -> c1",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    const c1 = result.finalClaims.find((claim) => claim.claimId === "c1");
    const c2 = result.finalClaims.find((claim) => claim.claimId === "c2");
    const c3 = result.finalClaims.find((claim) => claim.claimId === "c3");

    expect(c1?.status).toBe("active");
    expect(c2?.status).toBe("merged");
    expect(c2?.mergedInto).toBe("c1");
    expect(c3?.status).toBe("merged");
    expect(c3?.mergedInto).toBe("c1");
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
