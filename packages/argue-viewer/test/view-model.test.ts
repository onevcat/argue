import { describe, expect, it } from "vitest";
import { buildClaimInsights, buildContributionIndex, formatElapsed, rankScoreboard } from "../src/lib/view-model.js";
import { createFixtureResult } from "./fixtures.js";

describe("view-model helpers", () => {
  it("builds claim insights with stances and votes", () => {
    const result = createFixtureResult();
    const insights = buildClaimInsights(result);

    expect(insights.c1?.votes.accept).toBe(2);
    expect(insights.c2?.votes.reject).toBe(1);
    expect(insights.c1?.stances.agree).toBe(2);
    expect(insights.c2?.stances.revise).toBe(1);
  });

  it("ranks scoreboard by total descending", () => {
    const result = createFixtureResult();
    const ranked = rankScoreboard(result.scoreboard);
    expect(ranked[0]?.participantId).toBe("alice");
    expect(ranked[1]?.participantId).toBe("bob");
  });

  it("builds participant contribution index", () => {
    const result = createFixtureResult();
    const index = buildContributionIndex(result);

    expect(index.alice?.claimIds.has("c1")).toBe(true);
    expect(index.alice?.voteCount).toBe(2);
    expect(index.bob?.rounds.has(1)).toBe(true);
  });

  it("formats elapsed time", () => {
    expect(formatElapsed(980)).toBe("980 ms");
    expect(formatElapsed(4321)).toBe("4.3 s");
    expect(formatElapsed(130_000)).toBe("2:10");
  });
});
