import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArgueResult } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import { buildResultSummary, formatMs, writeRunArtifacts } from "../src/artifacts.js";

function makeResult(overrides?: Partial<ArgueResult>): ArgueResult {
  return {
    resultVersion: 1,
    requestId: "req-1",
    sessionId: "s1",
    status: "partial_consensus",
    finalClaims: [
      {
        claimId: "c1",
        title: "Use async/await",
        statement: "All new code should use async/await over raw promises.",
        category: "pro",
        proposedBy: ["agent-a"],
        status: "active"
      },
      {
        claimId: "c2",
        title: "Avoid callbacks",
        statement: "Callbacks lead to hard-to-read code.",
        category: "con",
        proposedBy: ["agent-b"],
        status: "active"
      },
      {
        claimId: "c3",
        title: "Merged claim",
        statement: "This was merged.",
        proposedBy: ["agent-a"],
        status: "merged",
        mergedInto: "c1"
      }
    ],
    claimResolutions: [
      {
        claimId: "c1",
        status: "resolved",
        acceptCount: 2,
        rejectCount: 0,
        totalVoters: 2,
        votes: [
          { participantId: "agent-a", claimId: "c1", vote: "accept" },
          { participantId: "agent-b", claimId: "c1", vote: "accept" }
        ]
      },
      {
        claimId: "c2",
        status: "unresolved",
        acceptCount: 1,
        rejectCount: 1,
        totalVoters: 2,
        votes: [
          { participantId: "agent-a", claimId: "c2", vote: "reject" },
          { participantId: "agent-b", claimId: "c2", vote: "accept" }
        ]
      }
    ],
    representative: {
      participantId: "agent-a",
      reason: "top-score",
      score: 87.5,
      speech: "We reached agreement on async/await."
    },
    scoreboard: [
      {
        participantId: "agent-a",
        total: 87.5,
        byRound: [
          { round: 0, score: 85 },
          { round: 1, score: 90 }
        ],
        breakdown: {
          correctness: 90,
          completeness: 85,
          actionability: 88,
          consistency: 87
        }
      },
      {
        participantId: "agent-b",
        total: 80,
        byRound: [{ round: 0, score: 80 }],
        breakdown: {
          correctness: 82,
          completeness: 78,
          actionability: 80,
          consistency: 80
        }
      }
    ],
    eliminations: [],
    report: {
      mode: "builtin",
      traceIncluded: false,
      traceLevel: "compact",
      finalSummary: "The group reached partial consensus on async/await usage.",
      representativeSpeech: "We reached agreement on async/await."
    },
    rounds: [
      {
        round: 0,
        outputs: [
          {
            participantId: "agent-a",
            round: 0,
            phase: "initial" as const,
            fullResponse: "resp",
            judgements: [{ claimId: "c1", stance: "agree" as const, confidence: 0.9, rationale: "solid" }],
            summary: "I agree"
          },
          {
            participantId: "agent-b",
            round: 0,
            phase: "initial" as const,
            fullResponse: "resp",
            judgements: [{ claimId: "c1", stance: "disagree" as const, confidence: 0.6, rationale: "hmm" }],
            summary: "I disagree"
          }
        ]
      },
      {
        round: 1,
        outputs: [
          {
            participantId: "agent-a",
            round: 1,
            phase: "debate" as const,
            fullResponse: "resp",
            judgements: [
              { claimId: "c1", stance: "agree" as const, confidence: 0.95, rationale: "very solid" },
              { claimId: "c2", stance: "disagree" as const, confidence: 0.7, rationale: "not great" }
            ],
            summary: "Still agree"
          },
          {
            participantId: "agent-b",
            round: 1,
            phase: "debate" as const,
            fullResponse: "resp",
            judgements: [
              { claimId: "c1", stance: "agree" as const, confidence: 0.85, rationale: "convinced" },
              { claimId: "c2", stance: "agree" as const, confidence: 0.8, rationale: "yes" }
            ],
            summary: "Now I agree"
          }
        ]
      }
    ],
    metrics: {
      elapsedMs: 15042,
      totalRounds: 2,
      totalTurns: 4,
      retries: 1,
      waitTimeouts: 0,
      earlyStopTriggered: false,
      globalDeadlineHit: false
    },
    ...overrides
  };
}

describe("formatMs", () => {
  it("formats sub-second durations as milliseconds", () => {
    expect(formatMs(0)).toBe("0ms");
    expect(formatMs(500)).toBe("500ms");
    expect(formatMs(999)).toBe("999ms");
  });

  it("formats sub-minute durations as seconds", () => {
    expect(formatMs(1000)).toBe("1.0s");
    expect(formatMs(15042)).toBe("15.0s");
    expect(formatMs(59999)).toBe("60.0s");
  });

  it("formats minute+ durations as Xm Ys", () => {
    expect(formatMs(60000)).toBe("1m0s");
    expect(formatMs(150000)).toBe("2m30s");
    expect(formatMs(61500)).toBe("1m2s");
  });
});

describe("buildResultSummary", () => {
  it("includes metadata section with correct data", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("# argue run req-1");
    expect(summary).toContain("status: partial_consensus");
    expect(summary).toContain("representative: agent-a");
    expect(summary).toContain("elapsed: 15.0s");
    expect(summary).toContain("rounds: 2");
    expect(summary).toContain("turns: 4");
    expect(summary).toContain("claims: 2 active / 3 total");
    expect(summary).toContain("resolved: 1/2");
  });

  it("includes conclusion section with finalSummary", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("## Conclusion");
    expect(summary).toContain("The group reached partial consensus on async/await usage.");
  });

  it("includes representative statement section", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("## Representative Statement");
    expect(summary).toContain("We reached agreement on async/await.");
  });

  it("includes claims section with per-claim details", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("## Claims");
    // Claim details
    expect(summary).toContain("### Use async/await");
    expect(summary).toContain("All new code should use async/await over raw promises.");
    expect(summary).toContain("category: pro");
    expect(summary).toContain("accept: 2 / reject: 0");

    expect(summary).toContain("### Avoid callbacks");
    expect(summary).toContain("category: con");
    expect(summary).toContain("accept: 1 / reject: 1");
  });

  it("extracts per-agent stance from last round judgements", () => {
    const summary = buildResultSummary(makeResult());

    // Last round (round 1) stances for c1
    expect(summary).toContain("agent-a: agree (0.95)");
    expect(summary).toContain("agent-b: agree (0.85)");

    // Last round stances for c2
    expect(summary).toContain("agent-a: disagree (0.70)");
    expect(summary).toContain("agent-b: agree (0.80)");
  });

  it("includes scoreboard sorted by total score descending", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("## Scoreboard");
    // agent-a (87.5) should appear before agent-b (80)
    const scoreboardIdx = summary.indexOf("## Scoreboard");
    const agentAIdx = summary.indexOf("agent-a | 87.50", scoreboardIdx);
    const agentBIdx = summary.indexOf("agent-b | 80.00", scoreboardIdx);
    expect(agentAIdx).toBeGreaterThan(0);
    expect(agentBIdx).toBeGreaterThan(0);
    expect(agentAIdx).toBeLessThan(agentBIdx);
  });

  it("includes score breakdown when present", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("correctness=90");
    expect(summary).toContain("completeness=85");
    expect(summary).toContain("actionability=88");
    expect(summary).toContain("consistency=87");
  });

  it("omits eliminations section when empty", () => {
    const summary = buildResultSummary(makeResult({ eliminations: [] }));
    expect(summary).not.toContain("## Eliminations");
  });

  it("includes eliminations when present", () => {
    const summary = buildResultSummary(
      makeResult({
        eliminations: [{ participantId: "agent-c", round: 2, reason: "timeout", at: "2026-01-01T00:00:00Z" }]
      })
    );

    expect(summary).toContain("## Eliminations");
    expect(summary).toContain("agent-c: timeout (round 2)");
  });

  it("omits disagreements section when absent or empty", () => {
    const summary = buildResultSummary(makeResult());
    expect(summary).not.toContain("## Disagreements");

    const summary2 = buildResultSummary(makeResult({ disagreements: [] }));
    expect(summary2).not.toContain("## Disagreements");
  });

  it("includes disagreements when present", () => {
    const summary = buildResultSummary(
      makeResult({
        disagreements: [{ claimId: "c2", participantId: "agent-a", reason: "Not actionable enough" }]
      })
    );

    expect(summary).toContain("## Disagreements");
    expect(summary).toContain("c2 — agent-a: Not actionable enough");
  });

  it("includes metrics section", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("## Metrics");
    expect(summary).toContain("elapsed: 15.0s");
    expect(summary).toContain("retries: 1");
    expect(summary).toContain("timeouts: 0");
    expect(summary).toContain("early stop: no");
    expect(summary).toContain("global deadline: no");
  });

  it("handles result with no rounds gracefully", () => {
    const summary = buildResultSummary(makeResult({ rounds: [] }));

    // Should still have claims section, just no stances
    expect(summary).toContain("## Claims");
    expect(summary).toContain("### Use async/await");
  });

  it("handles claims with no category", () => {
    const summary = buildResultSummary(
      makeResult({
        finalClaims: [
          {
            claimId: "c1",
            title: "Simple claim",
            statement: "A claim without category.",
            proposedBy: ["agent-a"],
            status: "active"
          }
        ]
      })
    );

    expect(summary).toContain("### Simple claim");
    expect(summary).not.toContain("category:");
  });

  it("handles scoreboard without breakdown", () => {
    const summary = buildResultSummary(
      makeResult({
        scoreboard: [{ participantId: "agent-a", total: 87.5, byRound: [{ round: 0, score: 87.5 }] }]
      })
    );

    expect(summary).toContain("## Scoreboard");
    expect(summary).toContain("agent-a | 87.50");
    expect(summary).not.toContain("correctness=");
  });
});

describe("writeRunArtifacts", () => {
  it("writes result json and summary markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-artifacts-"));
    const resultPath = join(root, "out", "result.json");
    const summaryPath = join(root, "out", "summary.md");

    await writeRunArtifacts({
      result: makeResult(),
      resultPath,
      summaryPath
    });

    const resultJson = JSON.parse(await readFile(resultPath, "utf8"));
    const summary = await readFile(summaryPath, "utf8");

    expect(resultJson.requestId).toBe("req-1");
    expect(summary).toContain("partial_consensus");
    expect(summary).toContain("## Conclusion");
  });
});
