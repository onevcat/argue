import type { NormalizedArgueStartInput } from "../contracts/request.js";
import type { Claim, ParticipantRoundOutput, ParticipantScore } from "../contracts/result.js";

type RubricWeights = NonNullable<NonNullable<NormalizedArgueStartInput["scoringPolicy"]>["rubric"]>;

type ScoreBreakdown = {
  correctness: number;
  completeness: number;
  actionability: number;
  consistency: number;
};

type WeightedRoundScore = {
  round: number;
  score: number;
  breakdown: ScoreBreakdown;
};

export function computeParticipantScores(args: {
  participants: string[];
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>;
  finalClaims: Claim[];
  scoringPolicy: NonNullable<NormalizedArgueStartInput["scoringPolicy"]>;
}): ParticipantScore[] {
  const byParticipantRound = new Map<string, WeightedRoundScore[]>();
  const weights = normalizeWeights(args.scoringPolicy.rubric);
  const correctnessByParticipant = computePeerReviewCorrectness(args.participants, args.rounds, args.finalClaims);

  for (const participant of args.participants) {
    byParticipantRound.set(participant, []);
  }

  for (const roundRecord of args.rounds) {
    const roundClaimTarget = Math.max(
      1,
      ...roundRecord.outputs.map((output) => Math.max(output.judgements.length, output.extractedClaims?.length ?? 0, 1))
    );

    for (const output of roundRecord.outputs) {
      const roundScores = byParticipantRound.get(output.participantId);
      if (!roundScores) continue;

      const nonCorrectness = scoreOutputNonCorrectness(output, roundClaimTarget);
      const breakdown: ScoreBreakdown = {
        correctness: correctnessByParticipant.get(output.participantId) ?? 50,
        ...nonCorrectness
      };

      roundScores.push({
        round: roundRecord.round,
        score: weightedTotal(breakdown, weights),
        breakdown
      });
    }
  }

  const result: ParticipantScore[] = [];
  for (const participant of args.participants) {
    const rounds = [...(byParticipantRound.get(participant) ?? [])].sort((a, b) => a.round - b.round);
    const byRound = rounds.map(({ round, score }) => ({ round, score }));

    const total =
      byRound.length > 0 ? roundTo2(byRound.reduce((sum, item) => sum + item.score, 0) / byRound.length) : 0;

    result.push({
      participantId: participant,
      total,
      byRound,
      breakdown: aggregateBreakdowns(rounds.map((item) => item.breakdown))
    });
  }

  return result.sort((a, b) => b.total - a.total || a.participantId.localeCompare(b.participantId));
}

export function chooseRepresentative(args: {
  scores: ParticipantScore[];
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>;
  tieBreaker: NonNullable<NormalizedArgueStartInput["scoringPolicy"]>["tieBreaker"];
}): { participantId: string; score: number; reason: "top-score" | "tie-breaker" } {
  if (args.scores.length === 0) {
    throw new Error("Cannot choose representative without participant scores");
  }

  const first = args.scores[0];
  if (!first) {
    throw new Error("Cannot choose representative without participant scores");
  }

  const topScore = first.total;
  const ties = args.scores.filter((x) => x.total === topScore);
  if (ties.length === 1) {
    const only = ties[0];
    if (!only) {
      throw new Error("Representative tie calculation failed");
    }
    return {
      participantId: only.participantId,
      score: only.total,
      reason: "top-score"
    };
  }

  const winner =
    args.tieBreaker === "least-objection"
      ? breakTieByLeastObjection(ties, args.rounds)
      : breakTieByLatestRoundScore(ties);

  return {
    participantId: winner.participantId,
    score: winner.total,
    reason: "tie-breaker"
  };
}

function computePeerReviewCorrectness(
  participants: string[],
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>,
  finalClaims: Claim[]
): Map<string, number> {
  const canonicalClaimId = buildCanonicalClaimMap(finalClaims);
  const claimOwners = new Map<string, string[]>();

  for (const claim of finalClaims) {
    const canonical = canonicalClaimId.get(claim.claimId) ?? claim.claimId;
    const existing = claimOwners.get(canonical) ?? [];
    const nextOwners = new Set([...existing, ...claim.proposedBy]);
    claimOwners.set(canonical, [...nextOwners]);
  }

  const stats = new Map<string, { agree: number; total: number }>();
  for (const participant of participants) {
    stats.set(participant, { agree: 0, total: 0 });
  }

  for (const round of rounds) {
    for (const output of round.outputs) {
      for (const judgement of output.judgements) {
        const canonical = canonicalClaimId.get(judgement.claimId) ?? judgement.claimId;
        const owners = claimOwners.get(canonical) ?? [];
        for (const owner of owners) {
          if (owner === output.participantId) continue;
          const item = stats.get(owner);
          if (!item) continue;
          item.total += 1;
          if (judgement.stance === "agree") {
            item.agree += 1;
          }
        }
      }
    }
  }

  const out = new Map<string, number>();
  for (const participant of participants) {
    const item = stats.get(participant);
    if (!item || item.total === 0) {
      out.set(participant, 50);
      continue;
    }
    out.set(participant, roundTo2((item.agree / item.total) * 100));
  }

  return out;
}

function buildCanonicalClaimMap(finalClaims: Claim[]): Map<string, string> {
  const direct = new Map<string, string>();
  for (const claim of finalClaims) {
    if (claim.status === "merged" && claim.mergedInto) {
      direct.set(claim.claimId, claim.mergedInto);
    }
  }

  const resolve = (id: string): string => {
    let current = id;
    const seen = new Set<string>();
    while (direct.has(current) && !seen.has(current)) {
      seen.add(current);
      const next = direct.get(current);
      if (!next) break;
      current = next;
    }
    return current;
  };

  const out = new Map<string, string>();
  for (const claim of finalClaims) {
    out.set(claim.claimId, resolve(claim.claimId));
  }
  return out;
}

function breakTieByLatestRoundScore(candidates: ParticipantScore[]): ParticipantScore {
  const sorted = [...candidates].sort((a, b) => {
    const latestA = a.byRound.at(-1)?.score ?? 0;
    const latestB = b.byRound.at(-1)?.score ?? 0;
    if (latestB !== latestA) return latestB - latestA;
    return a.participantId.localeCompare(b.participantId);
  });

  const winner = sorted[0];
  if (!winner) {
    throw new Error("No candidate available for latest-round-score tie-breaker");
  }
  return winner;
}

function breakTieByLeastObjection(
  candidates: ParticipantScore[],
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>
): ParticipantScore {
  const objections = new Map<string, number>();
  for (const candidate of candidates) objections.set(candidate.participantId, 0);

  for (const round of rounds) {
    for (const output of round.outputs) {
      if (!objections.has(output.participantId)) continue;
      const count = output.judgements.filter((j) => j.stance === "disagree").length;
      objections.set(output.participantId, (objections.get(output.participantId) ?? 0) + count);
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    const objectionA = objections.get(a.participantId) ?? 0;
    const objectionB = objections.get(b.participantId) ?? 0;
    if (objectionA !== objectionB) return objectionA - objectionB;
    return a.participantId.localeCompare(b.participantId);
  });

  const winner = sorted[0];
  if (!winner) {
    throw new Error("No candidate available for least-objection tie-breaker");
  }
  return winner;
}

function scoreOutputNonCorrectness(
  output: ParticipantRoundOutput,
  roundClaimTarget: number
): Omit<ScoreBreakdown, "correctness"> {
  const stanceAvg =
    output.judgements.length > 0
      ? output.judgements.reduce((sum, judgement) => sum + stanceFactor(judgement.stance), 0) / output.judgements.length
      : 0.7;

  const completeness = roundTo2(
    (clamp(output.judgements.length / Math.max(1, roundClaimTarget), 0, 1) * 0.5 +
      clamp(output.fullResponse.trim().length / 160, 0, 1) * 0.3 +
      clamp(output.summary.trim().length / 80, 0, 1) * 0.2) *
      100
  );

  const hasRevision = output.judgements.some((judgement) => typeof judgement.revisedStatement === "string");
  const hasVotes = output.phase === "final_vote" && (output.claimVotes?.length ?? 0) > 0;

  const actionability = roundTo2(
    (clamp(output.summary.trim().length / 60, 0, 1) * 0.45 +
      clamp(output.fullResponse.trim().length / 180, 0, 1) * 0.25 +
      (hasRevision ? 1 : 0.55) * 0.2 +
      (hasVotes ? 1 : 0.7) * 0.1) *
      100
  );

  const consistency = roundTo2(clamp(stanceAvg * 100, 0, 100));

  return {
    completeness,
    actionability,
    consistency
  };
}

function aggregateBreakdowns(breakdowns: ScoreBreakdown[]): ScoreBreakdown | undefined {
  if (breakdowns.length === 0) return undefined;

  return {
    correctness: roundTo2(average(breakdowns.map((item) => item.correctness))),
    completeness: roundTo2(average(breakdowns.map((item) => item.completeness))),
    actionability: roundTo2(average(breakdowns.map((item) => item.actionability))),
    consistency: roundTo2(average(breakdowns.map((item) => item.consistency)))
  };
}

function weightedTotal(breakdown: ScoreBreakdown, weights: RubricWeights): number {
  const totalWeight = weights.correctness + weights.completeness + weights.actionability + weights.consistency;
  const normalizedWeight = totalWeight > 0 ? totalWeight : 1;

  return roundTo2(
    (breakdown.correctness * weights.correctness +
      breakdown.completeness * weights.completeness +
      breakdown.actionability * weights.actionability +
      breakdown.consistency * weights.consistency) /
      normalizedWeight
  );
}

function normalizeWeights(rubric: RubricWeights): RubricWeights {
  const total = rubric.correctness + rubric.completeness + rubric.actionability + rubric.consistency;
  if (total > 0) {
    return { ...rubric };
  }

  return {
    correctness: 0.35,
    completeness: 0.25,
    actionability: 0.25,
    consistency: 0.15
  };
}

function stanceFactor(stance: "agree" | "disagree" | "revise"): number {
  if (stance === "agree") return 1;
  if (stance === "revise") return 0.8;
  return 0.6;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}
