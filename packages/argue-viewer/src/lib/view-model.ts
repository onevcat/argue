import type { ArgueResult, Claim, ClaimJudgement, ParticipantScore } from "@onevcat/argue";

type RoundRecord = ArgueResult["rounds"][number];

export type ClaimStanceCounts = {
  agree: number;
  disagree: number;
  revise: number;
};

export type ClaimInsight = {
  claimId: string;
  votes: {
    accept: number;
    reject: number;
    total: number;
  };
  stances: ClaimStanceCounts;
  judgements: Array<
    ClaimJudgement & {
      participantId: string;
      round: number;
    }
  >;
};

export type ContributionIndex = Record<
  string,
  {
    claimIds: Set<string>;
    rounds: Set<number>;
    judgementCount: number;
    voteCount: number;
  }
>;

export type RoundMerge = {
  sourceClaimId: string;
  targetClaimId: string;
  participantIds: string[];
};

export function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < 1_000) {
    return `${elapsedMs} ms`;
  }

  const seconds = elapsedMs / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainSeconds = Math.round(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainSeconds}`;
}

/**
 * Derive the debate date from the earliest `respondedAt` ISO timestamp
 * across all round outputs. Returns a short human-readable date
 * (`YYYY-MM-DD`) in UTC so the header meta stays stable regardless of
 * the viewer's locale. Returns null when no output carries a timestamp
 * so callers can omit the field cleanly.
 */
export function formatDebateDate(result: ArgueResult): string | null {
  let earliest: number | null = null;
  for (const round of result.rounds) {
    for (const output of round.outputs) {
      if (!output.respondedAt) continue;
      const t = Date.parse(output.respondedAt);
      if (Number.isNaN(t)) continue;
      if (earliest === null || t < earliest) {
        earliest = t;
      }
    }
  }
  if (earliest === null) return null;
  const date = new Date(earliest);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format an ISO timestamp for display next to round outputs.
 * Returns UTC `HH:MM:SS` so results render identically regardless of the
 * viewer's locale. Falls back to the raw string for unparseable input so
 * that malformed timestamps remain visible instead of silently disappearing.
 */
export function formatTimestamp(iso: string | undefined | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}Z`;
}

export function rankScoreboard(scoreboard: ParticipantScore[]): ParticipantScore[] {
  return [...scoreboard].sort(
    (left, right) => right.total - left.total || left.participantId.localeCompare(right.participantId)
  );
}

export function buildClaimInsights(result: ArgueResult): Record<string, ClaimInsight> {
  const insights: Record<string, ClaimInsight> = {};

  for (const resolution of result.claimResolutions) {
    insights[resolution.claimId] = {
      claimId: resolution.claimId,
      votes: {
        accept: resolution.acceptCount,
        reject: resolution.rejectCount,
        total: resolution.totalVoters
      },
      stances: { agree: 0, disagree: 0, revise: 0 },
      judgements: []
    };
  }

  for (const round of result.rounds) {
    for (const output of round.outputs) {
      for (const judgement of output.judgements) {
        const slot =
          insights[judgement.claimId] ??
          (insights[judgement.claimId] = {
            claimId: judgement.claimId,
            votes: { accept: 0, reject: 0, total: 0 },
            stances: { agree: 0, disagree: 0, revise: 0 },
            judgements: []
          });
        slot.stances[judgement.stance] += 1;
        slot.judgements.push({ ...judgement, participantId: output.participantId, round: round.round });
      }
    }
  }

  return insights;
}

/**
 * Name a round by its dominant phase so readers can scan the debate
 * flow instead of decoding numeric round indices.
 *
 * Rules:
 * - initial phase → "Initial Propose"
 * - final_vote phase → "Final Vote"
 * - debate phase → "Debate #N" where N is the 1-based position among
 *   debate rounds in chronological order
 * - unknown/empty → "Round N"
 */
export function nameRound(round: RoundRecord, allRounds: RoundRecord[]): string {
  const phase = round.outputs[0]?.phase;
  if (phase === "initial") {
    return "Initial Propose";
  }
  if (phase === "final_vote") {
    return "Final Vote";
  }
  if (phase === "debate") {
    const debateRounds = allRounds.filter((candidate) => candidate.outputs[0]?.phase === "debate");
    const position = debateRounds.findIndex((candidate) => candidate.round === round.round);
    return position >= 0 ? `Debate #${position + 1}` : `Debate Round ${round.round}`;
  }
  return `Round ${round.round}`;
}

/**
 * Mirror the engine's deterministic claim-id assignment for extracted
 * claims within a single round. The engine resets `seqByParticipant`
 * per round (inside `updateClaims`), so we do the same here and emit
 * `${participantId}:${round}:${seq}` ids per output position. The
 * result is keyed by "outputIndex:claimIndex" so the renderer can look
 * up the id without mutating state during render.
 */
export function computeExtractedClaimIds(round: RoundRecord): Record<string, string> {
  const ids: Record<string, string> = {};
  const seqByParticipant = new Map<string, number>();

  round.outputs.forEach((output, outputIndex) => {
    const extracted = output.extractedClaims ?? [];
    extracted.forEach((claim, claimIndex) => {
      const existing = claim.claimId;
      if (existing && existing.length > 0) {
        ids[`${outputIndex}:${claimIndex}`] = existing;
        return;
      }
      const seq = seqByParticipant.get(output.participantId) ?? 0;
      seqByParticipant.set(output.participantId, seq + 1);
      ids[`${outputIndex}:${claimIndex}`] = `${output.participantId}:${round.round}:${seq}`;
    });
  });

  return ids;
}

export type ClaimLookup = {
  byId: Record<string, Claim>;
  survivorId(claimId: string): string;
  describe(claimId: string): {
    claim: Claim | null;
    survivor: Claim | null;
    chain: string[];
  };
};

/**
 * Build a lookup that resolves claim id references against the final
 * claim catalogue, including merged-into survivorship so tooltip and
 * cross-reference consumers can walk the merge chain without caring
 * about ordering or intermediate nodes.
 */
export function buildClaimLookup(result: ArgueResult): ClaimLookup {
  const byId: Record<string, Claim> = {};
  for (const claim of result.finalClaims) {
    byId[claim.claimId] = claim;
  }

  const survivorId = (claimId: string): string => {
    let current = claimId;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(current)) {
        return current;
      }
      seen.add(current);
      const node = byId[current];
      if (!node || node.status !== "merged" || !node.mergedInto) {
        return current;
      }
      current = node.mergedInto;
    }
  };

  const describe = (claimId: string) => {
    const claim = byId[claimId] ?? null;
    const chain: string[] = [];
    let current = claimId;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(current)) break;
      seen.add(current);
      const node = byId[current];
      if (!node || node.status !== "merged" || !node.mergedInto) {
        break;
      }
      chain.push(node.mergedInto);
      current = node.mergedInto;
    }
    const survivor = chain.length > 0 ? (byId[chain[chain.length - 1]!] ?? null) : claim;
    return { claim, survivor, chain };
  };

  return { byId, survivorId, describe };
}

export function buildRoundMergeIndex(result: ArgueResult): Record<number, RoundMerge[]> {
  const hasStructuredRoundMerges = result.rounds.some((round) => round.appliedMerges !== undefined);
  if (hasStructuredRoundMerges) {
    const byRound: Record<number, RoundMerge[]> = {};
    for (const round of result.rounds) {
      const applied = round.appliedMerges ?? [];
      if (applied.length === 0) continue;
      byRound[round.round] = applied.map((merge) => ({
        sourceClaimId: merge.sourceClaimId,
        targetClaimId: merge.targetClaimId,
        participantIds: [...merge.participantIds].sort((a, b) => a.localeCompare(b))
      }));
    }
    return byRound;
  }

  const lookup = buildClaimLookup(result);
  const firstEffectiveMergeBySource = new Map<
    string,
    {
      round: number;
      targetClaimId: string;
      participantIds: string[];
    }
  >();

  for (const round of result.rounds) {
    for (const output of round.outputs) {
      for (const judgement of output.judgements) {
        if (!judgement.mergesWith) continue;

        const source = lookup.byId[judgement.claimId];
        if (!source || source.status !== "merged" || !source.mergedInto) continue;

        const actualTargetId = lookup.survivorId(judgement.claimId);
        const proposedTargetId = lookup.survivorId(judgement.mergesWith);
        if (actualTargetId === judgement.claimId || actualTargetId !== proposedTargetId) continue;

        const existing = firstEffectiveMergeBySource.get(judgement.claimId);
        if (!existing) {
          firstEffectiveMergeBySource.set(judgement.claimId, {
            round: round.round,
            targetClaimId: actualTargetId,
            participantIds: [output.participantId]
          });
          continue;
        }

        if (
          existing.round === round.round &&
          existing.targetClaimId === actualTargetId &&
          !existing.participantIds.includes(output.participantId)
        ) {
          existing.participantIds.push(output.participantId);
        }
      }
    }
  }

  const byRound: Record<number, RoundMerge[]> = {};
  for (const entry of firstEffectiveMergeBySource.entries()) {
    const [sourceClaimId, merge] = entry;
    byRound[merge.round] ??= [];
    byRound[merge.round]!.push({
      sourceClaimId,
      targetClaimId: merge.targetClaimId,
      participantIds: [...merge.participantIds].sort((a, b) => a.localeCompare(b))
    });
  }
  return byRound;
}

export function buildContributionIndex(result: ArgueResult): ContributionIndex {
  const index: ContributionIndex = {};

  const ensure = (participantId: string) => {
    index[participantId] ??= {
      claimIds: new Set<string>(),
      rounds: new Set<number>(),
      judgementCount: 0,
      voteCount: 0
    };
    return index[participantId];
  };

  for (const claim of result.finalClaims) {
    for (const participantId of claim.proposedBy) {
      ensure(participantId).claimIds.add(claim.claimId);
    }
  }

  for (const round of result.rounds) {
    for (const output of round.outputs) {
      const contribution = ensure(output.participantId);
      contribution.rounds.add(round.round);
      contribution.judgementCount += output.judgements.length;

      if (output.phase === "final_vote") {
        for (const vote of output.claimVotes) {
          contribution.voteCount += 1;
          contribution.claimIds.add(vote.claimId);
        }
      }

      for (const judgement of output.judgements) {
        contribution.claimIds.add(judgement.claimId);
      }
    }
  }

  return index;
}
