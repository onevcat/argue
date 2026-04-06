import type { ArgueStartInput } from "../contracts/request.js";
import type { ParticipantRoundOutput, ParticipantScore } from "../contracts/result.js";

export function computeParticipantScores(args: {
  participants: string[];
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>;
  scoringPolicy: NonNullable<ArgueStartInput["scoringPolicy"]>;
}): ParticipantScore[] {
  const byParticipantRound = new Map<string, Map<number, number>>();

  for (const participant of args.participants) {
    byParticipantRound.set(participant, new Map());
  }

  for (const roundRecord of args.rounds) {
    for (const output of roundRecord.outputs) {
      const roundMap = byParticipantRound.get(output.participantId);
      if (!roundMap) continue;
      roundMap.set(roundRecord.round, scoreOutput(output));
    }
  }

  const result: ParticipantScore[] = [];
  for (const participant of args.participants) {
    const roundMap = byParticipantRound.get(participant) ?? new Map();
    const byRound = [...roundMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, score]) => ({ round, score }));

    const total = byRound.length > 0
      ? roundTo2(byRound.reduce((sum, item) => sum + item.score, 0) / byRound.length)
      : 0;

    result.push({
      participantId: participant,
      total,
      byRound,
      breakdown: { ...args.scoringPolicy.rubric }
    });
  }

  return result.sort((a, b) => b.total - a.total || a.participantId.localeCompare(b.participantId));
}

export function chooseRepresentative(args: {
  scores: ParticipantScore[];
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>;
  tieBreaker: NonNullable<ArgueStartInput["scoringPolicy"]>["tieBreaker"];
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

  const winner = args.tieBreaker === "least-objection"
    ? breakTieByLeastObjection(ties, args.rounds)
    : breakTieByLatestRoundScore(ties);

  return {
    participantId: winner.participantId,
    score: winner.total,
    reason: "tie-breaker"
  };
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

function scoreOutput(output: ParticipantRoundOutput): number {
  if (typeof output.selfScore === "number") return roundTo2(clamp(output.selfScore, 0, 100));

  const confidenceAvg = output.judgements.length > 0
    ? output.judgements.reduce((sum, j) => sum + j.confidence, 0) / output.judgements.length
    : 0.5;

  const stanceAvg = output.judgements.length > 0
    ? output.judgements.reduce((sum, j) => sum + stanceFactor(j.stance), 0) / output.judgements.length
    : 0.7;

  let score = (confidenceAvg * 0.7 + stanceAvg * 0.3) * 100;
  if (output.phase === "final_vote" && output.vote === "accept") {
    score = Math.min(100, score + 5);
  }

  return roundTo2(score);
}

function stanceFactor(stance: "agree" | "disagree" | "revise"): number {
  if (stance === "agree") return 1;
  if (stance === "revise") return 0.8;
  return 0.6;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}
