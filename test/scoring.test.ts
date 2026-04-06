import { describe, expect, it } from "vitest";
import { computeParticipantScores } from "../src/core/scoring.js";
import type { ParticipantRoundOutput } from "../src/contracts/result.js";

describe("computeParticipantScores", () => {
  it("changes ranking when rubric weights change", () => {
    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [{
      round: 1,
      outputs: [
        {
          participantId: "high-confidence",
          phase: "debate",
          round: 1,
          fullResponse: "Detailed response that is long enough to look actionable and complete.",
          summary: "Detailed summary with concrete next steps.",
          judgements: [{
            claimId: "c1",
            stance: "disagree",
            confidence: 0.95,
            rationale: "Strong objection"
          }]
        },
        {
          participantId: "high-consistency",
          phase: "debate",
          round: 1,
          fullResponse: "Detailed response that is long enough to look actionable and complete.",
          summary: "Detailed summary with concrete next steps.",
          judgements: [{
            claimId: "c1",
            stance: "agree",
            confidence: 0.55,
            rationale: "Stable agreement"
          }]
        }
      ]
    }];

    const correctnessHeavy = computeParticipantScores({
      participants: ["high-confidence", "high-consistency"],
      rounds,
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

    const consistencyHeavy = computeParticipantScores({
      participants: ["high-confidence", "high-consistency"],
      rounds,
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        rubric: {
          correctness: 0,
          completeness: 0,
          actionability: 0,
          consistency: 1
        }
      }
    });

    expect(correctnessHeavy[0]?.participantId).toBe("high-confidence");
    expect(consistencyHeavy[0]?.participantId).toBe("high-consistency");
  });
});
