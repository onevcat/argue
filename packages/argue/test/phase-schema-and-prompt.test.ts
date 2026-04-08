import { describe, expect, it } from "vitest";
import { ArgueEngine } from "../src/core/engine.js";
import {
  DebateParticipantRoundOutputSchema,
  FinalVoteParticipantRoundOutputSchema,
  InitialParticipantRoundOutputSchema
} from "../src/contracts/result.js";
import type { ParticipantRoundOutput } from "../src/contracts/result.js";
import type { AgentTaskResult } from "../src/contracts/task.js";
import { StubAgentTaskDelegate } from "./helpers/stub-agent.js";

function mkRoundResult(output: ParticipantRoundOutput): AgentTaskResult {
  return {
    kind: "round",
    output
  };
}

describe("phase schemas", () => {
  it("enforces phase-specific payload rules", () => {
    expect(() => InitialParticipantRoundOutputSchema.parse({
      participantId: "a",
      phase: "initial",
      round: 0,
      fullResponse: "x",
      summary: "x",
      extractedClaims: [{ claimId: "c1", title: "t", statement: "s" }],
      judgements: []
    })).not.toThrow();

    expect(() => InitialParticipantRoundOutputSchema.parse({
      participantId: "a",
      phase: "initial",
      round: 0,
      fullResponse: "x",
      summary: "x",
      extractedClaims: [{ claimId: "c1", title: "t", statement: "s" }],
      judgements: [],
      claimVotes: [{ claimId: "c1", vote: "accept" }]
    })).toThrow();

    expect(() => DebateParticipantRoundOutputSchema.parse({
      participantId: "a",
      phase: "debate",
      round: 1,
      fullResponse: "x",
      summary: "x",
      judgements: [{
        claimId: "c1",
        stance: "disagree",
        confidence: 0.8,
        rationale: "..."
      }]
    })).not.toThrow();

    expect(() => FinalVoteParticipantRoundOutputSchema.parse({
      participantId: "a",
      phase: "final_vote",
      round: 2,
      fullResponse: "x",
      summary: "x",
      judgements: [{
        claimId: "c1",
        stance: "agree",
        confidence: 0.8,
        rationale: "..."
      }],
      claimVotes: []
    })).toThrow();
  });
});

describe("built-in prompt templates", () => {
  it("uses phase-specific prompt guidance and report schema guidance", async () => {
    const scenarios: Record<string, { type: "success"; output: AgentTaskResult }> = {
      "round:initial:0:a": {
        type: "success",
        output: mkRoundResult({
          participantId: "a",
          phase: "initial",
          round: 0,
          fullResponse: "init a",
          summary: "init a",
          extractedClaims: [{ claimId: "c1", title: "c1", statement: "s1" }],
          judgements: []
        })
      },
      "round:initial:0:b": {
        type: "success",
        output: mkRoundResult({
          participantId: "b",
          phase: "initial",
          round: 0,
          fullResponse: "init b",
          summary: "init b",
          extractedClaims: [{ claimId: "c2", title: "c2", statement: "s2" }],
          judgements: []
        })
      },
      "round:debate:1:a": {
        type: "success",
        output: mkRoundResult({
          participantId: "a",
          phase: "debate",
          round: 1,
          fullResponse: "debate a",
          summary: "debate a",
          judgements: [{
            claimId: "c2",
            stance: "disagree",
            confidence: 0.8,
            rationale: "need change"
          }]
        })
      },
      "round:debate:1:b": {
        type: "success",
        output: mkRoundResult({
          participantId: "b",
          phase: "debate",
          round: 1,
          fullResponse: "debate b",
          summary: "debate b",
          judgements: [{
            claimId: "c1",
            stance: "agree",
            confidence: 0.8,
            rationale: "ok"
          }]
        })
      },
      "round:final_vote:2:a": {
        type: "success",
        output: mkRoundResult({
          participantId: "a",
          phase: "final_vote",
          round: 2,
          fullResponse: "vote a",
          summary: "vote a",
          judgements: [{
            claimId: "c1",
            stance: "agree",
            confidence: 0.8,
            rationale: "ok"
          }],
          claimVotes: [{ claimId: "c1", vote: "accept" }]
        })
      },
      "round:final_vote:2:b": {
        type: "success",
        output: mkRoundResult({
          participantId: "b",
          phase: "final_vote",
          round: 2,
          fullResponse: "vote b",
          summary: "vote b",
          judgements: [{
            claimId: "c1",
            stance: "agree",
            confidence: 0.8,
            rationale: "ok"
          }],
          claimVotes: [{ claimId: "c1", vote: "accept" }]
        })
      },
      "report:external-reporter": {
        type: "success",
        output: {
          kind: "report",
          output: {
            mode: "representative",
            traceIncluded: false,
            traceLevel: "compact",
            finalSummary: "ok",
            representativeSpeech: "ok"
          }
        }
      }
    };

    const delegate = new StubAgentTaskDelegate(scenarios);
    const engine = new ArgueEngine({ taskDelegate: delegate });

    await engine.start({
      requestId: "req-prompt",
      topic: "Prompt quality",
      objective: "Ensure phase prompts are explicit",
      participants: [{ id: "a" }, { id: "b" }],
      roundPolicy: { minRounds: 1, maxRounds: 1 },
      reportPolicy: {
        composer: "representative",
        representativeId: "external-reporter"
      }
    });

    const roundDispatches = delegate.dispatchCalls.filter((x) => x.kind === "round");
    const initialPrompt = roundDispatches.find((x) => x.kind === "round" && x.phase === "initial")?.prompt ?? "";
    const debatePrompt = roundDispatches.find((x) => x.kind === "round" && x.phase === "debate")?.prompt ?? "";
    const finalPrompt = roundDispatches.find((x) => x.kind === "round" && x.phase === "final_vote")?.prompt ?? "";
    const reportPrompt = delegate.dispatchCalls.find((x) => x.kind === "report")?.prompt ?? "";

    expect(initialPrompt).toContain("Schema requirements (initial)");
    expect(initialPrompt).toContain("Initial phase JSON template");

    expect(debatePrompt).toContain("Schema requirements (debate)");
    expect(debatePrompt).toContain("mergesWith");

    expect(finalPrompt).toContain("Schema requirements (final_vote)");
    expect(finalPrompt).toContain("claimVotes");

    expect(reportPrompt).toContain("Generate FinalReport");
    expect(reportPrompt).toContain("FinalReport JSON template");
  });
});
