import { describe, expect, it } from "vitest";
import { buildBuiltinReport } from "../src/core/report-compose.js";

describe("buildBuiltinReport", () => {
  it("omits timeline/highlights when trace is disabled", () => {
    const report = buildBuiltinReport({
      includeDeliberationTrace: false,
      traceLevel: "compact",
      status: "consensus",
      representativeSpeech: "rep",
      representativeId: "a1",
      rounds: [
        {
          round: 0,
          outputs: [{
            participantId: "a1",
            phase: "initial",
            round: 0,
            fullResponse: "full",
            summary: "sum",
            judgements: []
          }]
        }
      ]
    });

    expect(report.traceIncluded).toBe(false);
    expect(report.opinionShiftTimeline).toBeUndefined();
    expect(report.roundHighlights).toBeUndefined();
  });

  it("builds opinion shift timeline and truncates highlights by trace level", () => {
    const long = "x".repeat(400);
    const rounds = [
      {
        round: 1,
        outputs: [
          {
            participantId: "a1",
            phase: "debate" as const,
            round: 1,
            fullResponse: "r1",
            summary: long,
            judgements: [{ claimId: "c1", stance: "agree" as const, confidence: 0.9, rationale: "ok" }]
          }
        ]
      },
      {
        round: 2,
        outputs: [
          {
            participantId: "a1",
            phase: "debate" as const,
            round: 2,
            fullResponse: "r2",
            summary: long,
            judgements: [{ claimId: "c1", stance: "disagree" as const, confidence: 0.9, rationale: "change" }]
          }
        ]
      }
    ];

    const compact = buildBuiltinReport({
      includeDeliberationTrace: true,
      traceLevel: "compact",
      status: "partial_consensus",
      representativeSpeech: "rep",
      representativeId: "a1",
      rounds
    });

    const full = buildBuiltinReport({
      includeDeliberationTrace: true,
      traceLevel: "full",
      status: "partial_consensus",
      representativeSpeech: "rep",
      representativeId: "a1",
      rounds
    });

    expect(compact.opinionShiftTimeline).toEqual([
      expect.objectContaining({ claimId: "c1", participantId: "a1", from: "unknown", to: "agree", round: 1 }),
      expect.objectContaining({ claimId: "c1", participantId: "a1", from: "agree", to: "disagree", round: 2 })
    ]);

    expect(compact.roundHighlights?.[0]?.summary.length).toBe(140);
    expect(full.roundHighlights?.[0]?.summary.length).toBe(280);
    expect(compact.finalSummary).toContain("representative=a1");
  });
});
