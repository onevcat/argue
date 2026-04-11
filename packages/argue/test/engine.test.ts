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
  catalogClaimIds?: string[];
  extractedClaims?: Array<{
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
  const catalogIds = input.catalogClaimIds ?? [];
  const defaultJudgements: typeof input.judgements = catalogIds.map((id) => ({
    claimId: id,
    stance: input.stance ?? ("agree" as const)
  }));
  const judgements = (input.judgements ?? defaultJudgements).map((judgement) => ({
    claimId: judgement.claimId,
    stance: judgement.stance,
    confidence: judgement.confidence ?? 0.9,
    rationale: judgement.rationale ?? `${input.participantId} rationale ${input.phase} ${input.round}`,
    revisedStatement: judgement.revisedStatement,
    mergesWith: judgement.mergesWith
  }));
  const extractedClaims = input.extractedClaims ?? [
    {
      title: "Claim",
      statement: "Claim statement",
      category: "pro" as const
    }
  ];
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
    claimVotes: input.claimVotes ?? catalogIds.map((id) => ({ claimId: id, vote: "accept" as const })),
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

    // Engine assigns IDs: {participantId}:{round}:{seq}
    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:debate:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 2, catalogClaimIds: allClaimIds })
        )
      };
    }

    const allVotes = allClaimIds.map((id) => ({ claimId: id, vote: "accept" as const }));
    scenarios["round:final_vote:3:onevclaw"] = {
      type: "success",
      output: roundResult(
        mkRoundOutput({
          participantId: "onevclaw",
          phase: "final_vote",
          round: 3,
          catalogClaimIds: allClaimIds,
          claimVotes: allVotes
        })
      )
    };
    scenarios["round:final_vote:3:onevpaw"] = {
      type: "success",
      output: roundResult(
        mkRoundOutput({
          participantId: "onevpaw",
          phase: "final_vote",
          round: 3,
          catalogClaimIds: allClaimIds,
          claimVotes: allVotes
        })
      )
    };
    scenarios["round:final_vote:3:onevtail"] = { type: "timeout" };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });

    const result = await engine.start({
      requestId: "req-effective-voters",
      task: "Consensus denominator",
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
    expect(result.eliminations).toContainEqual(
      expect.objectContaining({
        participantId: "onevtail",
        round: 3,
        reason: "timeout"
      })
    );
    expect(result.metrics.earlyStopTriggered).toBe(true);

    for (const round of result.rounds) {
      for (const output of round.outputs) {
        expect(output.respondedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  });

  it("falls back to builtin report when representative report task fails", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult } | { type: "fail"; error: string }> =
      {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
        )
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
      task: "Report fallback",
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

  it("falls back to builtin report when representative await throws", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult } | { type: "throw"; error: string }> =
      {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
        )
      };
    }

    scenarios["report:external-reporter"] = {
      type: "throw",
      error: "delegate await crashed"
    };

    const result = await new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) }).start({
      requestId: "req-report-throw-fallback",
      task: "Report fallback",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      reportPolicy: {
        composer: "representative",
        representativeId: "external-reporter"
      }
    });

    expect(result.report.mode).toBe("builtin");
  });

  it("falls back to builtin report when representative payload is malformed", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
        )
      };
    }

    scenarios["report:external-reporter"] = {
      type: "success",
      output: {
        kind: "report",
        output: {
          mode: "representative",
          traceIncluded: false,
          traceLevel: "compact",
          finalSummary: "malformed"
        }
      } as unknown as AgentTaskResult
    };

    const result = await new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) }).start({
      requestId: "req-report-malformed-fallback",
      task: "Report fallback",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      reportPolicy: {
        composer: "representative",
        representativeId: "external-reporter"
      }
    });

    expect(result.report.mode).toBe("builtin");
  });

  it("marks unresolved when global deadline is reached before final_vote", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
    }

    let nowMs = 0;
    const engine = new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate(scenarios),
      now: () => nowMs,
      observer: {
        onEvent(event) {
          if (event.type !== "RoundCompleted") return;
          if (event.payload?.phase !== "debate") return;
          nowMs = 2000;
        }
      }
    });

    const result = await engine.start({
      requestId: "req-deadline-before-final-vote",
      task: "deadline",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      waitingPolicy: {
        perTaskTimeoutMs: 1000,
        perRoundTimeoutMs: 5000,
        globalDeadlineMs: 1500
      }
    });

    expect(result.status).toBe("unresolved");
    expect(result.metrics.globalDeadlineHit).toBe(true);
    expect(result.rounds.some((round) => round.outputs.some((output) => output.phase === "final_vote"))).toBe(false);
  });

  it("freezes claim catalog during final_vote", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "C1", statement: "baseline", category: "pro" }]
          })
        )
      },
      "round:initial:0:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "initial",
            round: 0
          })
        )
      },
      "round:initial:0:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "initial",
            round: 0
          })
        )
      },
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }]
          })
        )
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }]
          })
        )
      },
      "round:debate:1:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }]
          })
        )
      },
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "final_vote",
            round: 2,
            extractedClaims: [{ title: "C99", statement: "inject", category: "risk" }],
            judgements: [
              {
                claimId: "onevclaw:0:0",
                stance: "revise",
                revisedStatement: "mutated",
                mergesWith: "onevclaw:2:0"
              }
            ],
            claimVotes: [{ claimId: "onevclaw:0:0", vote: "accept" }]
          })
        )
      },
      "round:final_vote:2:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "final_vote",
            round: 2,
            claimVotes: [{ claimId: "onevclaw:0:0", vote: "accept" }]
          })
        )
      },
      "round:final_vote:2:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "final_vote",
            round: 2,
            claimVotes: [{ claimId: "onevclaw:0:0", vote: "accept" }]
          })
        )
      }
    };

    const result = await new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) }).start({
      requestId: "req-freeze-final-vote-claims",
      task: "freeze",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    const c1 = result.finalClaims.find((claim) => claim.claimId === "onevclaw:0:0");
    const c99 = result.finalClaims.find((claim) => claim.title === "C99");

    expect(c99).toBeUndefined();
    expect(c1?.statement).toBe("baseline");
    expect(c1?.status).toBe("active");
  });

  it("uses host-designated representative when designated participant is active", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
        )
      };
    }

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });

    const result = await engine.start({
      requestId: "req-designated",
      task: "Designated representative",
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
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "C1", statement: "claim 1", category: "pro" }]
          })
        )
      },
      "round:initial:0:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "C2", statement: "claim 2", category: "pro" }]
          })
        )
      },
      "round:initial:0:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "C3", statement: "claim 3", category: "risk" }]
          })
        )
      },
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "debate",
            round: 1,
            judgements: [
              {
                claimId: "onevpaw:0:0",
                stance: "revise",
                revisedStatement: "c2 is actually same as c1",
                mergesWith: "onevclaw:0:0"
              }
            ]
          })
        )
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevclaw:0:0", stance: "disagree" }]
          })
        )
      },
      "round:debate:1:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }]
          })
        )
      },
      "round:debate:2:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "debate",
            round: 2,
            judgements: [{ claimId: "onevclaw:0:0", stance: "disagree" }]
          })
        )
      },
      "round:debate:2:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "debate",
            round: 2,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }]
          })
        )
      },
      "round:debate:2:onevtail": {
        type: "timeout"
      },
      "round:debate:3:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "debate",
            round: 3,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }]
          })
        )
      },
      "round:debate:3:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "debate",
            round: 3,
            judgements: [{ claimId: "onevclaw:0:0", stance: "disagree" }]
          })
        )
      },
      "round:final_vote:4:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "final_vote",
            round: 4,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }],
            claimVotes: [
              { claimId: "onevclaw:0:0", vote: "accept" },
              { claimId: "onevtail:0:0", vote: "reject" }
            ]
          })
        )
      },
      "round:final_vote:4:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "final_vote",
            round: 4,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }],
            claimVotes: [
              { claimId: "onevclaw:0:0", vote: "accept" },
              { claimId: "onevtail:0:0", vote: "reject" }
            ]
          })
        )
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
      task: "full DI edge cases",
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

    expect(result.eliminations).toContainEqual(
      expect.objectContaining({
        participantId: "onevtail",
        round: 2,
        reason: "timeout"
      })
    );

    const c2 = result.finalClaims.find((claim) => claim.claimId === "onevpaw:0:0");
    const c1 = result.finalClaims.find((claim) => claim.claimId === "onevclaw:0:0");
    expect(c2?.status).toBe("merged");
    expect(c2?.mergedInto).toBe("onevclaw:0:0");
    expect(c1?.proposedBy.sort()).toEqual(["onevclaw", "onevpaw"].sort());

    const c1Resolution = result.claimResolutions.find((item) => item.claimId === "onevclaw:0:0");
    const c3Resolution = result.claimResolutions.find((item) => item.claimId === "onevtail:0:0");
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
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "C1", statement: "claim 1", category: "pro" }]
          })
        )
      },
      "round:initial:0:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "C2", statement: "claim 2", category: "pro" }]
          })
        )
      },
      "round:initial:0:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "C3", statement: "claim 3", category: "pro" }]
          })
        )
      },
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevpaw:0:0", stance: "agree", mergesWith: "onevclaw:0:0" }]
          })
        )
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevtail:0:0", stance: "agree", mergesWith: "onevpaw:0:0" }]
          })
        )
      },
      "round:debate:1:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "debate",
            round: 1,
            judgements: [{ claimId: "onevclaw:0:0", stance: "agree" }]
          })
        )
      },
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "final_vote",
            round: 2,
            claimVotes: [{ claimId: "onevclaw:0:0", vote: "accept" }]
          })
        )
      },
      "round:final_vote:2:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "final_vote",
            round: 2,
            claimVotes: [{ claimId: "onevclaw:0:0", vote: "accept" }]
          })
        )
      },
      "round:final_vote:2:onevtail": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevtail",
            phase: "final_vote",
            round: 2,
            claimVotes: [{ claimId: "onevclaw:0:0", vote: "accept" }]
          })
        )
      }
    };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });
    const result = await engine.start({
      requestId: "req-chain-merge",
      task: "chain merge",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    const c1 = result.finalClaims.find((claim) => claim.claimId === "onevclaw:0:0");
    const c2 = result.finalClaims.find((claim) => claim.claimId === "onevpaw:0:0");
    const c3 = result.finalClaims.find((claim) => claim.claimId === "onevtail:0:0");

    expect(c1?.status).toBe("active");
    expect(c2?.status).toBe("merged");
    expect(c2?.mergedInto).toBe("onevclaw:0:0");
    expect(c3?.status).toBe("merged");
    expect(c3?.mergedInto).toBe("onevclaw:0:0");
  });

  it("covers full claim lifecycle: create, debate-introduce, merge, revise, vote", async () => {
    // Round 0 (initial): each agent proposes one claim → engine assigns IDs
    // Round 1 (debate): onevpaw introduces a NEW claim; onevclaw merges
    //                    onevpaw:0:0 into onevclaw:0:0 and revises statement
    // Round 2 (final_vote): vote on all active claims
    //
    // Expected final catalog:
    //   onevclaw:0:0 — active (merged with onevpaw:0:0, revised statement)
    //   onevpaw:0:0  — merged into onevclaw:0:0
    //   onevpaw:1:0  — active (new claim introduced in debate round 1)
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "Perf is fine", statement: "Benchmarks show no regression", category: "pro" }]
          })
        )
      },
      "round:initial:0:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ title: "Perf needs work", statement: "Latency p99 is too high", category: "con" }]
          })
        )
      },
      // Debate: onevclaw merges onevpaw:0:0 into onevclaw:0:0 with revised statement
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "debate",
            round: 1,
            judgements: [
              {
                claimId: "onevpaw:0:0",
                stance: "revise",
                revisedStatement: "Perf is acceptable after targeted p99 fix",
                mergesWith: "onevclaw:0:0"
              }
            ]
          })
        )
      },
      // Debate: onevpaw introduces a NEW claim and agrees on existing
      "round:debate:1:onevpaw": {
        type: "success",
        output: {
          kind: "round",
          output: {
            participantId: "onevpaw",
            phase: "debate" as const,
            round: 1,
            fullResponse: "onevpaw:debate:1",
            summary: "onevpaw debate summary",
            extractedClaims: [
              { title: "Missing test coverage", statement: "No integration tests for the new path", category: "risk" }
            ],
            judgements: [
              { claimId: "onevclaw:0:0", stance: "agree" as const, confidence: 0.9, rationale: "agree" }
            ]
          }
        }
      },
      // Final vote: vote on active claims (onevclaw:0:0 survived merge, onevpaw:1:0 is new)
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "final_vote",
            round: 2,
            catalogClaimIds: ["onevclaw:0:0", "onevpaw:1:0"],
            claimVotes: [
              { claimId: "onevclaw:0:0", vote: "accept" },
              { claimId: "onevpaw:1:0", vote: "accept" }
            ]
          })
        )
      },
      "round:final_vote:2:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "final_vote",
            round: 2,
            catalogClaimIds: ["onevclaw:0:0", "onevpaw:1:0"],
            claimVotes: [
              { claimId: "onevclaw:0:0", vote: "accept" },
              { claimId: "onevpaw:1:0", vote: "accept" }
            ]
          })
        )
      }
    };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });
    const result = await engine.start({
      requestId: "req-lifecycle",
      task: "full claim lifecycle",
      participants: [{ id: "onevclaw" }, { id: "onevpaw" }],
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    // 1. Initial claims get engine-assigned IDs with round 0
    const perfClaim = result.finalClaims.find((c) => c.claimId === "onevclaw:0:0");
    const latencyClaim = result.finalClaims.find((c) => c.claimId === "onevpaw:0:0");
    expect(perfClaim).toBeDefined();
    expect(latencyClaim).toBeDefined();

    // 2. Merge: onevpaw:0:0 merged into onevclaw:0:0
    expect(latencyClaim!.status).toBe("merged");
    expect(latencyClaim!.mergedInto).toBe("onevclaw:0:0");
    expect(perfClaim!.status).toBe("active");
    expect(perfClaim!.proposedBy.sort()).toEqual(["onevclaw", "onevpaw"]);

    // 3. Revise: revisedStatement applies to the judged claim (the loser), not the survivor
    expect(latencyClaim!.statement).toBe("Perf is acceptable after targeted p99 fix");
    expect(perfClaim!.statement).toBe("Benchmarks show no regression");

    // 4. New claim introduced in debate round 1 gets round=1 in its ID
    const newClaim = result.finalClaims.find((c) => c.claimId === "onevpaw:1:0");
    expect(newClaim).toBeDefined();
    expect(newClaim!.title).toBe("Missing test coverage");
    expect(newClaim!.proposedBy).toEqual(["onevpaw"]);
    expect(newClaim!.status).toBe("active");

    // 5. No ID collisions — total claims = 3
    expect(result.finalClaims).toHaveLength(3);

    // 6. Consensus on active claims
    expect(result.status).toBe("consensus");
    const perfRes = result.claimResolutions.find((r) => r.claimId === "onevclaw:0:0");
    const newRes = result.claimResolutions.find((r) => r.claimId === "onevpaw:1:0");
    expect(perfRes?.status).toBe("resolved");
    expect(newRes?.status).toBe("resolved");
  });

  it("emits round participant events in real completion timeline", async () => {
    const twoClaimIds = ["onevclaw:0:0", "onevpaw:0:0"];
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult; delayMs?: number }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        delayMs: 5,
        output: roundResult(mkRoundOutput({ participantId: "onevclaw", phase: "initial", round: 0 }))
      },
      "round:initial:0:onevpaw": {
        type: "success",
        delayMs: 40,
        output: roundResult(mkRoundOutput({ participantId: "onevpaw", phase: "initial", round: 0 }))
      },
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: "onevclaw", phase: "debate", round: 1, catalogClaimIds: twoClaimIds })
        )
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: "onevpaw", phase: "debate", round: 1, catalogClaimIds: twoClaimIds })
        )
      },
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: "onevclaw", phase: "final_vote", round: 2, catalogClaimIds: twoClaimIds })
        )
      },
      "round:final_vote:2:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: "onevpaw", phase: "final_vote", round: 2, catalogClaimIds: twoClaimIds })
        )
      }
    };

    const timeline: Array<{
      type: string;
      at: string;
      payload?: Record<string, unknown>;
    }> = [];

    const engine = new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate(scenarios),
      observer: {
        onEvent(event) {
          if (
            event.type !== "RoundDispatched" &&
            event.type !== "ParticipantResponded" &&
            event.type !== "RoundCompleted"
          ) {
            return;
          }
          timeline.push({
            type: event.type,
            at: event.at,
            payload: event.payload
          });
        }
      }
    });

    await engine.start({
      requestId: "req-realtime-timeline",
      task: "timeline",
      participants: [{ id: "onevclaw" }, { id: "onevpaw" }],
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      waitingPolicy: {
        perTaskTimeoutMs: 1000,
        perRoundTimeoutMs: 1000
      }
    });

    const initialDispatch = timeline.find(
      (event) => event.type === "RoundDispatched" && event.payload?.phase === "initial" && event.payload?.round === 0
    );
    const initialResponses = timeline.filter(
      (event) =>
        event.type === "ParticipantResponded" && event.payload?.phase === "initial" && event.payload?.round === 0
    );
    const initialRoundCompleted = timeline.find(
      (event) => event.type === "RoundCompleted" && event.payload?.phase === "initial" && event.payload?.round === 0
    );

    expect(initialDispatch).toBeDefined();
    expect(initialResponses.map((event) => event.payload?.participantId)).toEqual(["onevclaw", "onevpaw"]);
    expect(initialResponses[0]?.payload).toEqual(
      expect.objectContaining({
        summary: expect.any(String),
        extractedClaims: expect.any(Number),
        judgements: expect.any(Number),
        stanceAgree: expect.any(Number),
        stanceDisagree: expect.any(Number),
        stanceRevise: expect.any(Number),
        claimVotes: 0
      })
    );
    expect(initialRoundCompleted).toBeDefined();
    expect(initialRoundCompleted?.payload).toEqual(
      expect.objectContaining({
        claimCatalogSize: expect.any(Number),
        newClaims: expect.any(Number),
        mergeCount: expect.any(Number)
      })
    );

    if (initialDispatch && initialRoundCompleted) {
      const dispatchAt = Date.parse(initialDispatch.at);
      const firstAt = Date.parse(initialResponses[0]!.at);
      const secondAt = Date.parse(initialResponses[1]!.at);
      const roundCompletedAt = Date.parse(initialRoundCompleted.at);

      expect(firstAt).toBeGreaterThanOrEqual(dispatchAt);
      expect(secondAt).toBeGreaterThanOrEqual(firstAt);
      expect(roundCompletedAt).toBeGreaterThanOrEqual(secondAt);
    }
  });

  it("dispatches action when actionPolicy is set", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
        )
      };
    }

    // The representative will be chosen by scoring; add action scenario for all participants
    for (const participant of PARTICIPANTS) {
      scenarios[`action:${participant}`] = {
        type: "success",
        output: {
          kind: "action",
          output: { fullResponse: "action executed", summary: "action summary" }
        }
      };
    }

    const events: string[] = [];
    const delegate = new StubAgentTaskDelegate(scenarios);
    const engine = new ArgueEngine({
      taskDelegate: delegate,
      observer: {
        onEvent(event) {
          events.push(event.type);
        }
      }
    });

    const result = await engine.start({
      requestId: "req-action-dispatched",
      task: "Action dispatch test",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      actionPolicy: {
        prompt: "Take action based on the debate result"
      }
    });

    expect(events).toContain("ActionDispatched");
    expect(events).toContain("ActionCompleted");
    expect(result.action).toBeDefined();
    expect(result.action?.status).toBe("completed");
    expect(result.action?.fullResponse).toBe("action executed");
    expect(result.action?.summary).toBe("action summary");

    const actionDispatch = delegate.dispatchCalls.find((x) => x.kind === "action");
    expect(actionDispatch).toBeDefined();
    if (actionDispatch?.kind === "action") {
      expect(actionDispatch.sessionId).toContain(":action:");
      expect(actionDispatch.prompt).toBe("Take action based on the debate result");
    }
  });

  it("skips action when actionPolicy is not set", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
        )
      };
    }

    const events: string[] = [];
    const engine = new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate(scenarios),
      observer: {
        onEvent(event) {
          events.push(event.type);
        }
      }
    });

    const result = await engine.start({
      requestId: "req-no-action",
      task: "No action test",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    expect(events).not.toContain("ActionDispatched");
    expect(events).not.toContain("ActionCompleted");
    expect(events).not.toContain("ActionFailed");
    expect(result.action).toBeUndefined();
  });

  it("returns failed action without invalidating debate result", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult } | { type: "fail"; error: string }> =
      {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
      scenarios[`round:final_vote:2:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
        )
      };
    }

    // Make action dispatch throw for all possible representatives
    for (const participant of PARTICIPANTS) {
      scenarios[`action:${participant}`] = {
        type: "fail",
        error: "action service unavailable"
      };
    }

    const events: string[] = [];
    const engine = new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate(scenarios),
      observer: {
        onEvent(event) {
          events.push(event.type);
        }
      }
    });

    const result = await engine.start({
      requestId: "req-action-failure",
      task: "Action failure test",
      participants: PARTICIPANTS.map((id) => ({ id })),
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      actionPolicy: {
        prompt: "Take action"
      }
    });

    expect(events).toContain("ActionDispatched");
    expect(events).toContain("ActionFailed");
    expect(events).not.toContain("ActionCompleted");

    // Debate result is still valid
    expect(["consensus", "partial_consensus", "unresolved"]).toContain(result.status);
    expect(result.action).toBeDefined();
    expect(result.action?.status).toBe("failed");
  });

  it("emits ActionFailed when configured actor is no longer active", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult } | { type: "timeout" }> = {};

    const allClaimIds = PARTICIPANTS.map((p) => `${p}:0:0`);
    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(
          mkRoundOutput({ participantId: participant, phase: "debate", round: 1, catalogClaimIds: allClaimIds })
        )
      };
    }

    scenarios["round:final_vote:2:onevclaw"] = { type: "timeout" };
    scenarios["round:final_vote:2:onevpaw"] = {
      type: "success",
      output: roundResult(
        mkRoundOutput({ participantId: "onevpaw", phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
      )
    };
    scenarios["round:final_vote:2:onevtail"] = {
      type: "success",
      output: roundResult(
        mkRoundOutput({ participantId: "onevtail", phase: "final_vote", round: 2, catalogClaimIds: allClaimIds })
      )
    };

    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const result = await new ArgueEngine({
      taskDelegate: new StubAgentTaskDelegate(scenarios),
      observer: {
        onEvent(event) {
          events.push({ type: event.type, payload: event.payload as Record<string, unknown> | undefined });
        }
      }
    }).start({
      requestId: "req-action-inactive-actor",
      task: "Inactive action actor",
      participants: PARTICIPANTS.map((id) => ({ id })),
      participantsPolicy: { minParticipants: 2 },
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      waitingPolicy: {
        perTaskTimeoutMs: 1000,
        perRoundTimeoutMs: 1000
      },
      actionPolicy: {
        prompt: "Take action",
        actorId: "onevclaw"
      }
    });

    expect(result.action).toEqual({
      actorId: "onevclaw",
      status: "failed",
      error: "Actor onevclaw is not an active participant"
    });
    expect(events).toContainEqual({
      type: "ActionFailed",
      payload: {
        actorId: "onevclaw",
        reason: "inactive_actor"
      }
    });
  });

  it("assigns unique engine IDs when multiple agents propose claims", async () => {
    // Two agents each propose two claims in the initial round. The engine
    // assigns IDs in {participantId}:{round}:{seq} format — no agent-provided
    // claimId is used.
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [
              { title: "Alpha claim", statement: "Alpha statement", category: "pro" },
              { title: "Beta claim", statement: "Beta statement", category: "con" }
            ]
          })
        )
      },
      "round:initial:0:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "initial",
            round: 0,
            extractedClaims: [
              { title: "Gamma claim", statement: "Gamma statement", category: "risk" },
              { title: "Delta claim", statement: "Delta statement", category: "todo" }
            ]
          })
        )
      },
      "round:debate:1:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "debate",
            round: 1,
            catalogClaimIds: ["onevclaw:0:0", "onevclaw:0:1", "onevpaw:0:0", "onevpaw:0:1"]
          })
        )
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "debate",
            round: 1,
            catalogClaimIds: ["onevclaw:0:0", "onevclaw:0:1", "onevpaw:0:0", "onevpaw:0:1"]
          })
        )
      },
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "final_vote",
            round: 2,
            catalogClaimIds: ["onevclaw:0:0", "onevclaw:0:1", "onevpaw:0:0", "onevpaw:0:1"]
          })
        )
      },
      "round:final_vote:2:onevpaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevpaw",
            phase: "final_vote",
            round: 2,
            catalogClaimIds: ["onevclaw:0:0", "onevclaw:0:1", "onevpaw:0:0", "onevpaw:0:1"]
          })
        )
      }
    };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });
    const result = await engine.start({
      requestId: "req-claim-collision",
      task: "engine-assigned claim IDs",
      participants: [{ id: "onevclaw" }, { id: "onevpaw" }],
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    // 4 active claims, each with engine-assigned IDs
    const activeClaims = result.finalClaims.filter((c) => c.status === "active");
    expect(activeClaims).toHaveLength(4);

    // onevclaw's claims
    const alpha = result.finalClaims.find((c) => c.title === "Alpha claim");
    expect(alpha).toBeDefined();
    expect(alpha!.claimId).toBe("onevclaw:0:0");
    expect(alpha!.proposedBy).toEqual(["onevclaw"]);

    const beta = result.finalClaims.find((c) => c.title === "Beta claim");
    expect(beta).toBeDefined();
    expect(beta!.claimId).toBe("onevclaw:0:1");
    expect(beta!.proposedBy).toEqual(["onevclaw"]);

    // onevpaw's claims
    const gamma = result.finalClaims.find((c) => c.title === "Gamma claim");
    expect(gamma).toBeDefined();
    expect(gamma!.claimId).toBe("onevpaw:0:0");
    expect(gamma!.proposedBy).toEqual(["onevpaw"]);

    const delta = result.finalClaims.find((c) => c.title === "Delta claim");
    expect(delta).toBeDefined();
    expect(delta!.claimId).toBe("onevpaw:0:1");
    expect(delta!.proposedBy).toEqual(["onevpaw"]);
  });

  it("rejects removed waiting/report policy fields", async () => {
    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate({}) });

    await expect(
      engine.start({
        requestId: "req-invalid-fields",
        task: "invalid",
        participants: [{ id: "a" }, { id: "b" }],
        waitingPolicy: {
          perTaskTimeoutMs: 1000,
          perRoundTimeoutMs: 1000,
          mode: "event-first"
        } as unknown as {
          perTaskTimeoutMs: number;
          perRoundTimeoutMs: number;
        }
      })
    ).rejects.toThrow();

    await expect(
      engine.start({
        requestId: "req-invalid-report-fields",
        task: "invalid",
        participants: [{ id: "a" }, { id: "b" }],
        reportPolicy: {
          composer: "builtin",
          maxReportChars: 1000
        } as unknown as {
          composer: "builtin";
        }
      })
    ).rejects.toThrow();
  });
});
