import { describe, expect, it } from "vitest";
import { buildBuiltinReport } from "../src/core/report-compose.js";

const baseInput = {
  includeDeliberationTrace: false,
  traceLevel: "compact" as const,
  status: "consensus" as const,
  representativeSpeech: "rep",
  representativeId: "a1",
  finalClaims: [],
  claimResolutions: []
};

describe("buildBuiltinReport", () => {
  it("omits timeline/highlights when trace is disabled", () => {
    const report = buildBuiltinReport({
      ...baseInput,
      rounds: [
        {
          round: 0,
          outputs: [
            {
              participantId: "a1",
              phase: "initial",
              round: 0,
              fullResponse: "full",
              taskTitle: "demo task",
              summary: "sum",
              judgements: []
            }
          ]
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
      ...baseInput,
      includeDeliberationTrace: true,
      traceLevel: "compact",
      status: "partial_consensus",
      rounds
    });

    const full = buildBuiltinReport({
      ...baseInput,
      includeDeliberationTrace: true,
      traceLevel: "full",
      status: "partial_consensus",
      rounds
    });

    expect(compact.opinionShiftTimeline).toEqual([
      expect.objectContaining({ claimId: "c1", participantId: "a1", from: "unknown", to: "agree", round: 1 }),
      expect.objectContaining({ claimId: "c1", participantId: "a1", from: "agree", to: "disagree", round: 2 })
    ]);

    expect(compact.roundHighlights?.[0]?.summary.length).toBe(140);
    expect(full.roundHighlights?.[0]?.summary.length).toBe(280);
  });

  it("builds summary with status, claims, and vote results", () => {
    const report = buildBuiltinReport({
      ...baseInput,
      status: "consensus",
      finalClaims: [
        { claimId: "c1", title: "Main point", statement: "s1", proposedBy: ["a1"], status: "active" },
        { claimId: "c2", title: "Supporting fact", statement: "s2", proposedBy: ["a1", "a2"], status: "active" }
      ],
      claimResolutions: [
        { claimId: "c1", status: "resolved", acceptCount: 2, rejectCount: 0, totalVoters: 2, votes: [] },
        { claimId: "c2", status: "resolved", acceptCount: 2, rejectCount: 0, totalVoters: 2, votes: [] }
      ],
      rounds: [
        {
          round: 0,
          outputs: [
            {
              participantId: "a1",
              phase: "initial",
              round: 0,
              fullResponse: "f",
              taskTitle: "demo task",
              summary: "Agent A's view",
              judgements: []
            },
            {
              participantId: "a2",
              phase: "initial",
              round: 0,
              fullResponse: "f",
              taskTitle: "demo task",
              summary: "Agent B's view",
              judgements: []
            }
          ]
        }
      ]
    });

    expect(report.finalSummary).toContain("Consensus reached");
    expect(report.finalSummary).toContain("**a1**: Agent A's view");
    expect(report.finalSummary).toContain("**a2**: Agent B's view");
    // No claim lists or vote tallies in the summary
    expect(report.finalSummary).not.toContain("claims");
    expect(report.finalSummary).not.toContain("accept)");
  });

  it("shows partial consensus and unresolved claims", () => {
    const report = buildBuiltinReport({
      ...baseInput,
      status: "partial_consensus",
      finalClaims: [
        { claimId: "c1", title: "Agreed", statement: "s1", proposedBy: ["a1"], status: "active" },
        { claimId: "c2", title: "Disputed", statement: "s2", proposedBy: ["a2"], status: "active" }
      ],
      claimResolutions: [
        { claimId: "c1", status: "resolved", acceptCount: 2, rejectCount: 0, totalVoters: 2, votes: [] },
        { claimId: "c2", status: "unresolved", acceptCount: 1, rejectCount: 1, totalVoters: 2, votes: [] }
      ],
      rounds: []
    });

    expect(report.finalSummary).toContain("Partial consensus");
    // No claim details or vote tallies — just status label when no rounds
    expect(report.finalSummary).toBe("Partial consensus.");
    expect(report.finalSummary).not.toContain("resolved");
    expect(report.finalSummary).not.toContain("accept)");
  });

  it("includes last round summaries, not earlier rounds", () => {
    const report = buildBuiltinReport({
      ...baseInput,
      rounds: [
        {
          round: 0,
          outputs: [
            {
              participantId: "a1",
              phase: "initial",
              round: 0,
              fullResponse: "f",
              taskTitle: "demo task",
              summary: "Early thoughts",
              judgements: []
            }
          ]
        },
        {
          round: 2,
          outputs: [
            {
              participantId: "a1",
              phase: "debate",
              round: 2,
              fullResponse: "f",
              summary: "Final thoughts",
              judgements: []
            }
          ]
        },
        {
          round: 1,
          outputs: [
            {
              participantId: "a1",
              phase: "debate",
              round: 1,
              fullResponse: "f",
              summary: "Middle thoughts",
              judgements: []
            }
          ]
        }
      ]
    });

    expect(report.finalSummary).toContain("Final thoughts");
    expect(report.finalSummary).not.toContain("Early thoughts");
    expect(report.finalSummary).not.toContain("Middle thoughts");
  });
});
