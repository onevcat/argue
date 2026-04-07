import { describe, expect, it } from "vitest";
import { computeParticipantScores } from "../src/core/scoring.js";
import type { Claim, ParticipantRoundOutput } from "../src/contracts/result.js";

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
});
