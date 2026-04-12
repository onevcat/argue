import type { ArgueResult, ParticipantScore } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import {
  buildClaimInsights,
  buildContributionIndex,
  formatElapsed,
  formatTimestamp,
  rankScoreboard
} from "../src/lib/view-model.js";
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

  it("creates orphan claim insight when a judgement references an unresolved claim", () => {
    const result = createFixtureResult();
    // inject a judgement for a claim that has no resolution entry.
    result.rounds[0]!.outputs[0]!.judgements.push({
      claimId: "orphan",
      stance: "agree",
      confidence: 0.5,
      rationale: "n/a"
    });

    const insights = buildClaimInsights(result);
    expect(insights.orphan?.votes.total).toBe(0);
    expect(insights.orphan?.stances.agree).toBe(1);
    expect(insights.orphan?.judgements).toHaveLength(1);
  });

  it("ranks scoreboard by total descending", () => {
    const result = createFixtureResult();
    const ranked = rankScoreboard(result.scoreboard);
    expect(ranked[0]?.participantId).toBe("alice");
    expect(ranked[1]?.participantId).toBe("bob");
  });

  it("breaks scoreboard ties alphabetically by participantId", () => {
    const tied: ParticipantScore[] = [
      { participantId: "charlie", total: 80, byRound: [] },
      { participantId: "alice", total: 80, byRound: [] },
      { participantId: "bob", total: 80, byRound: [] }
    ];
    const ranked = rankScoreboard(tied);
    expect(ranked.map((item) => item.participantId)).toEqual(["alice", "bob", "charlie"]);
  });

  it("does not mutate the input scoreboard", () => {
    const scoreboard: ParticipantScore[] = [
      { participantId: "a", total: 10, byRound: [] },
      { participantId: "b", total: 20, byRound: [] }
    ];
    const copy = [...scoreboard];
    rankScoreboard(scoreboard);
    expect(scoreboard).toEqual(copy);
  });

  it("builds participant contribution index", () => {
    const result = createFixtureResult();
    const index = buildContributionIndex(result);

    expect(index.alice?.claimIds.has("c1")).toBe(true);
    expect(index.alice?.voteCount).toBe(2);
    expect(index.bob?.rounds.has(1)).toBe(true);
  });

  it("returns empty index when rounds and claims are empty", () => {
    const result = createFixtureResult();
    const empty: ArgueResult = { ...result, rounds: [], finalClaims: [] };
    expect(buildContributionIndex(empty)).toEqual({});
  });

  it("formats elapsed time across boundaries", () => {
    expect(formatElapsed(0)).toBe("0 ms");
    expect(formatElapsed(980)).toBe("980 ms");
    expect(formatElapsed(999)).toBe("999 ms");
    expect(formatElapsed(1_000)).toBe("1.0 s");
    expect(formatElapsed(4_321)).toBe("4.3 s");
    expect(formatElapsed(59_999)).toBe("60.0 s");
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(130_000)).toBe("2:10");
    expect(formatElapsed(3_600_000)).toBe("60:00");
  });

  describe("formatTimestamp", () => {
    it("formats ISO strings as UTC HH:MM:SSZ", () => {
      expect(formatTimestamp("2026-04-12T03:49:25.105Z")).toBe("03:49:25Z");
      expect(formatTimestamp("2026-12-31T23:59:59.000Z")).toBe("23:59:59Z");
    });

    it("ignores timezone offsets in the input by normalizing to UTC", () => {
      expect(formatTimestamp("2026-04-12T10:00:00+07:00")).toBe("03:00:00Z");
    });

    it("returns a dash for missing input", () => {
      expect(formatTimestamp(undefined)).toBe("—");
      expect(formatTimestamp(null)).toBe("—");
      expect(formatTimestamp("")).toBe("—");
    });

    it("falls back to the raw string for unparseable input", () => {
      expect(formatTimestamp("not-a-date")).toBe("not-a-date");
    });
  });
});
