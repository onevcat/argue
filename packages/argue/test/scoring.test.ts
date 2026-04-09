import { describe, expect, it } from "vitest";
import { chooseRepresentative, computeParticipantScores } from "../src/core/scoring.js";
import type { Claim, ParticipantRoundOutput, ParticipantScore } from "../src/contracts/result.js";

describe("computeParticipantScores", () => {
  it("uses peer-review as correctness core signal", () => {
    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [{
      round: 1,
      outputs: [
        {
          participantId: "p1",
          phase: "debate",
          round: 1,
          fullResponse: "p1 response",
          summary: "p1 summary",
          judgements: [{
            claimId: "c2",
            stance: "agree",
            confidence: 0.9,
            rationale: "agree p2"
          }]
        },
        {
          participantId: "p2",
          phase: "debate",
          round: 1,
          fullResponse: "p2 response",
          summary: "p2 summary",
          judgements: [{
            claimId: "c1",
            stance: "disagree",
            confidence: 0.9,
            rationale: "disagree p1"
          }]
        }
      ]
    }];

    const finalClaims: Claim[] = [
      {
        claimId: "c1",
        title: "c1",
        statement: "c1",
        proposedBy: ["p1"],
        status: "active"
      },
      {
        claimId: "c2",
        title: "c2",
        statement: "c2",
        proposedBy: ["p2"],
        status: "active"
      }
    ];

    const correctnessHeavy = computeParticipantScores({
      participants: ["p1", "p2"],
      rounds,
      finalClaims,
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        rubric: {
          correctness: 1,
          completeness: 0,
          actionability: 0,
          consistency: 0
        }
      }
    });

    expect(correctnessHeavy[0]?.participantId).toBe("p2");
    expect(correctnessHeavy[1]?.participantId).toBe("p1");
  });

  it("falls back to default rubric weights when all weights are zero", () => {
    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [{
      round: 1,
      outputs: [{
        participantId: "p1",
        phase: "debate",
        round: 1,
        fullResponse: "response",
        summary: "summary",
        judgements: [{
          claimId: "c1",
          stance: "agree",
          confidence: 0.9,
          rationale: "ok"
        }]
      }]
    }];

    const finalClaims: Claim[] = [{
      claimId: "c1",
      title: "c1",
      statement: "c1",
      proposedBy: ["p1"],
      status: "active"
    }];

    const scores = computeParticipantScores({
      participants: ["p1"],
      rounds,
      finalClaims,
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        rubric: {
          correctness: 0,
          completeness: 0,
          actionability: 0,
          consistency: 0
        }
      }
    });

    expect(scores[0]?.total).toBeGreaterThan(0);
    expect(Number.isNaN(scores[0]?.total ?? NaN)).toBe(false);
  });
});

describe("chooseRepresentative", () => {
  const tiedScores: ParticipantScore[] = [
    {
      participantId: "p1",
      total: 90,
      byRound: [{ round: 1, score: 80 }, { round: 2, score: 88 }]
    },
    {
      participantId: "p2",
      total: 90,
      byRound: [{ round: 1, score: 85 }, { round: 2, score: 89 }]
    }
  ];

  it("breaks ties by latest round score", () => {
    const chosen = chooseRepresentative({
      scores: tiedScores,
      rounds: [],
      tieBreaker: "latest-round-score"
    });

    expect(chosen.participantId).toBe("p2");
    expect(chosen.reason).toBe("tie-breaker");
  });

  it("breaks ties by least objection", () => {
    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [{
      round: 1,
      outputs: [
        {
          participantId: "p1",
          phase: "debate",
          round: 1,
          fullResponse: "p1",
          summary: "p1",
          judgements: [
            { claimId: "c1", stance: "disagree", confidence: 0.8, rationale: "no" },
            { claimId: "c2", stance: "disagree", confidence: 0.8, rationale: "no" }
          ]
        },
        {
          participantId: "p2",
          phase: "debate",
          round: 1,
          fullResponse: "p2",
          summary: "p2",
          judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "yes" }]
        }
      ]
    }];

    const chosen = chooseRepresentative({
      scores: tiedScores,
      rounds,
      tieBreaker: "least-objection"
    });

    expect(chosen.participantId).toBe("p2");
    expect(chosen.reason).toBe("tie-breaker");
  });
});
