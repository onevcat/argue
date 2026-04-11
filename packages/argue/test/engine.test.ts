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
  const judgements = (
    input.judgements ?? [
      {
        claimId,
        stance: input.stance ?? "agree"
      }
    ]
  ).map((judgement) => ({
    claimId: judgement.claimId,
    stance: judgement.stance,
    confidence: judgement.confidence ?? 0.9,
    rationale: judgement.rationale ?? `${input.participantId} rationale ${input.phase} ${input.round}`,
    revisedStatement: judgement.revisedStatement,
    mergesWith: judgement.mergesWith
  }));
  const extractedClaims = input.extractedClaims ?? [
    {
      claimId,
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

    const claimIds = { onevclaw: "c1", onevpaw: "c2", onevtail: "c3" } as const;
    for (const participant of PARTICIPANTS) {
      const extractedClaimId = claimIds[participant];
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0, extractedClaimId }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 1, extractedClaimId }))
      };
      scenarios[`round:debate:2:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 2, extractedClaimId }))
      };
    }

    const allVotes = Object.values(claimIds).map((id) => ({ claimId: id, vote: "accept" as const }));
    scenarios["round:final_vote:3:onevclaw"] = {
      type: "success",
      output: roundResult(
        mkRoundOutput({
          participantId: "onevclaw",
          phase: "final_vote",
          round: 3,
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

    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 1 }))
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
            extractedClaims: [{ claimId: "c1", title: "C1", statement: "baseline", category: "pro" }],
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            extractedClaims: [{ claimId: "c99", title: "C99", statement: "inject", category: "risk" }],
            judgements: [
              {
                claimId: "c1",
                stance: "revise",
                revisedStatement: "mutated",
                mergesWith: "c99"
              }
            ],
            claimVotes: [{ claimId: "c1", vote: "accept" }]
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
            claimVotes: [{ claimId: "c1", vote: "accept" }]
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
            claimVotes: [{ claimId: "c1", vote: "accept" }]
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

    const c1 = result.finalClaims.find((claim) => claim.claimId === "c1");
    const c99 = result.finalClaims.find((claim) => claim.claimId === "c99");

    expect(c99).toBeUndefined();
    expect(c1?.statement).toBe("baseline");
    expect(c1?.status).toBe("active");
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
            extractedClaims: [{ claimId: "c1", title: "C1", statement: "claim 1", category: "pro" }],
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            extractedClaims: [{ claimId: "c2", title: "C2", statement: "claim 2", category: "pro" }],
            judgements: [{ claimId: "c2", stance: "agree" }]
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
            extractedClaims: [{ claimId: "c3", title: "C3", statement: "claim 3", category: "risk" }],
            judgements: [{ claimId: "c3", stance: "agree" }]
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
                claimId: "c2",
                stance: "revise",
                revisedStatement: "c2 is actually same as c1",
                mergesWith: "c1"
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
            judgements: [{ claimId: "c1", stance: "disagree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "disagree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            judgements: [{ claimId: "c1", stance: "disagree" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }],
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c3", vote: "reject" }
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
            judgements: [{ claimId: "c1", stance: "agree" }],
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c3", vote: "reject" }
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
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ claimId: "c1", title: "C1", statement: "claim 1", category: "pro" }],
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            extractedClaims: [{ claimId: "c2", title: "C2", statement: "claim 2", category: "pro" }],
            judgements: [{ claimId: "c2", stance: "agree" }]
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
            extractedClaims: [{ claimId: "c3", title: "C3", statement: "claim 3", category: "pro" }],
            judgements: [{ claimId: "c3", stance: "agree" }]
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
            judgements: [{ claimId: "c2", stance: "agree", mergesWith: "c1" }]
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
            judgements: [{ claimId: "c3", stance: "agree", mergesWith: "c2" }]
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
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            claimVotes: [{ claimId: "c1", vote: "accept" }]
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
            claimVotes: [{ claimId: "c1", vote: "accept" }]
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
            claimVotes: [{ claimId: "c1", vote: "accept" }]
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

    const c1 = result.finalClaims.find((claim) => claim.claimId === "c1");
    const c2 = result.finalClaims.find((claim) => claim.claimId === "c2");
    const c3 = result.finalClaims.find((claim) => claim.claimId === "c3");

    expect(c1?.status).toBe("active");
    expect(c2?.status).toBe("merged");
    expect(c2?.mergedInto).toBe("c1");
    expect(c3?.status).toBe("merged");
    expect(c3?.mergedInto).toBe("c1");
  });

  it("emits round participant events in real completion timeline", async () => {
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
        output: roundResult(mkRoundOutput({ participantId: "onevclaw", phase: "debate", round: 1 }))
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: "onevpaw", phase: "debate", round: 1 }))
      },
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: "onevclaw", phase: "final_vote", round: 2 }))
      },
      "round:final_vote:2:onevpaw": {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: "onevpaw", phase: "final_vote", round: 2 }))
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

    for (const participant of PARTICIPANTS) {
      scenarios[`round:initial:0:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "initial", round: 0 }))
      };
      scenarios[`round:debate:1:${participant}`] = {
        type: "success",
        output: roundResult(mkRoundOutput({ participantId: participant, phase: "debate", round: 1 }))
      };
    }

    scenarios["round:final_vote:2:onevclaw"] = { type: "timeout" };
    scenarios["round:final_vote:2:onevpaw"] = {
      type: "success",
      output: roundResult(mkRoundOutput({ participantId: "onevpaw", phase: "final_vote", round: 2 }))
    };
    scenarios["round:final_vote:2:onevtail"] = {
      type: "success",
      output: roundResult(mkRoundOutput({ participantId: "onevtail", phase: "final_vote", round: 2 }))
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

  it("disambiguates same-round claim ID collisions between agents", async () => {
    // Two agents independently propose claims with the same IDs (c1, c2) in the
    // initial round but with completely different content. The engine must treat
    // them as separate claims rather than silently merging them.
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [
              { claimId: "c1", title: "Alpha claim", statement: "Alpha statement", category: "pro" },
              { claimId: "c2", title: "Beta claim", statement: "Beta statement", category: "con" }
            ],
            judgements: [
              { claimId: "c1", stance: "agree" },
              { claimId: "c2", stance: "agree" }
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
              { claimId: "c1", title: "Gamma claim", statement: "Gamma statement", category: "risk" },
              { claimId: "c2", title: "Delta claim", statement: "Delta statement", category: "todo" }
            ],
            judgements: [
              { claimId: "c1", stance: "agree" },
              { claimId: "c2", stance: "agree" }
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
            judgements: [
              { claimId: "c1", stance: "agree" },
              { claimId: "c2", stance: "agree" }
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
            judgements: [
              { claimId: "c1", stance: "agree" },
              { claimId: "c2", stance: "agree" }
            ]
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
            judgements: [
              { claimId: "c1", stance: "agree" },
              { claimId: "c2", stance: "agree" }
            ],
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c2", vote: "accept" }
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
            judgements: [
              { claimId: "c1", stance: "agree" },
              { claimId: "c2", stance: "agree" }
            ],
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c2", vote: "accept" }
            ]
          })
        )
      }
    };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });
    const result = await engine.start({
      requestId: "req-claim-collision",
      task: "claim ID collision test",
      participants: [{ id: "onevclaw" }, { id: "onevpaw" }],
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    // Both agents proposed c1 and c2 independently — should yield 4 claims, not 2.
    const activeClaims = result.finalClaims.filter((c) => c.status === "active");
    expect(activeClaims).toHaveLength(4);

    // onevclaw's claims should only be proposed by onevclaw
    const alpha = result.finalClaims.find((c) => c.title === "Alpha claim");
    expect(alpha).toBeDefined();
    expect(alpha!.proposedBy).toEqual(["onevclaw"]);

    // onevpaw's claims should be preserved with their own content
    const gamma = result.finalClaims.find((c) => c.title === "Gamma claim");
    expect(gamma).toBeDefined();
    expect(gamma!.proposedBy).toEqual(["onevpaw"]);

    // The two c1 claims should have different IDs after disambiguation
    expect(alpha!.claimId).not.toBe(gamma!.claimId);
  });

  it("still allows re-proposal of pre-existing claims from prior rounds", async () => {
    // In the debate round, an agent re-extracts a claim that already exists in
    // the catalog from a prior round. This should be treated as a legitimate
    // re-proposal (adding to proposedBy), NOT as a collision.
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "initial",
            round: 0,
            extractedClaims: [{ claimId: "c1", title: "Original claim", statement: "original", category: "pro" }],
            judgements: [{ claimId: "c1", stance: "agree" }]
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
            extractedClaims: [{ claimId: "c2", title: "Second claim", statement: "second", category: "con" }],
            judgements: [{ claimId: "c2", stance: "agree" }]
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
              { claimId: "c1", stance: "agree" },
              { claimId: "c2", stance: "agree" }
            ]
          })
        )
      },
      "round:debate:1:onevpaw": {
        type: "success",
        output: {
          kind: "round",
          output: {
            participantId: "onevpaw",
            phase: "debate" as const,
            round: 1,
            fullResponse: "onevpaw:debate:1",
            summary: "onevpaw summary",
            // onevpaw re-extracts c1 from the catalog — legitimate re-proposal
            extractedClaims: [{ claimId: "c1", title: "Original claim", statement: "original", category: "pro" }],
            judgements: [
              { claimId: "c1", stance: "agree" as const, confidence: 0.9, rationale: "agree" },
              { claimId: "c2", stance: "agree" as const, confidence: 0.9, rationale: "agree" }
            ]
          }
        }
      },
      "round:final_vote:2:onevclaw": {
        type: "success",
        output: roundResult(
          mkRoundOutput({
            participantId: "onevclaw",
            phase: "final_vote",
            round: 2,
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c2", vote: "accept" }
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
            claimVotes: [
              { claimId: "c1", vote: "accept" },
              { claimId: "c2", vote: "accept" }
            ]
          })
        )
      }
    };

    const engine = new ArgueEngine({ taskDelegate: new StubAgentTaskDelegate(scenarios) });
    const result = await engine.start({
      requestId: "req-reproposal",
      task: "re-proposal test",
      participants: [{ id: "onevclaw" }, { id: "onevpaw" }],
      roundPolicy: { minRounds: 1, maxRounds: 1 }
    });

    // c1 should still be a single claim with both agents as proposers
    const c1 = result.finalClaims.find((c) => c.claimId === "c1");
    expect(c1).toBeDefined();
    expect(c1!.proposedBy.sort()).toEqual(["onevclaw", "onevpaw"]);

    // No duplicate of c1 should exist
    const c1Matches = result.finalClaims.filter((c) => c.title === "Original claim");
    expect(c1Matches).toHaveLength(1);
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
