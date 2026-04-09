import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArgueResult } from "argue";
import { describe, expect, it } from "vitest";
import { buildResultSummary, writeRunArtifacts } from "../src/artifacts.js";

function makeResult(): ArgueResult {
  return {
    requestId: "req-1",
    sessionId: "s1",
    status: "partial_consensus",
    finalClaims: [
      {
        claimId: "c1",
        title: "c1",
        statement: "claim",
        proposedBy: ["a1"],
        status: "active"
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
          { participantId: "a1", claimId: "c1", vote: "accept" },
          { participantId: "a2", claimId: "c1", vote: "accept" }
        ]
      }
    ],
    representative: {
      participantId: "a1",
      reason: "top-score",
      score: 87.5,
      speech: "speech"
    },
    scoreboard: [
      { participantId: "a1", total: 87.5, byRound: [{ round: 0, score: 87.5 }] },
      { participantId: "a2", total: 80, byRound: [{ round: 0, score: 80 }] }
    ],
    eliminations: [
      { participantId: "a2", round: 1, reason: "timeout", at: new Date().toISOString() }
    ],
    report: {
      mode: "builtin",
      traceIncluded: false,
      traceLevel: "compact",
      finalSummary: "summary",
      representativeSpeech: "speech"
    },
    rounds: [],
    metrics: {
      elapsedMs: 1,
      totalRounds: 1,
      totalTurns: 2,
      retries: 0,
      waitTimeouts: 1,
      earlyStopTriggered: false,
      globalDeadlineHit: false
    }
  };
}

describe("artifacts", () => {
  it("builds readable markdown summary", () => {
    const summary = buildResultSummary(makeResult());

    expect(summary).toContain("# argue run req-1");
    expect(summary).toContain("score=87.50");
    expect(summary).toContain("## Eliminations");
    expect(summary).toContain("a2: timeout at round 1");
    expect(summary).toContain("## Summary");
  });

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
  });
});
