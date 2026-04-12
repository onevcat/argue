import type { ArgueResult, ClaimJudgement, ClaimVote, ParticipantScore } from "@onevcat/argue";

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
  voteDetails: ClaimVote[];
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
      judgements: [],
      voteDetails: resolution.votes
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
            judgements: [],
            voteDetails: []
          });
        slot.stances[judgement.stance] += 1;
        slot.judgements.push({ ...judgement, participantId: output.participantId, round: round.round });
      }
    }
  }

  return insights;
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
