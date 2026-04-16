import type { Claim, ClaimResolution, FinalReport, OpinionShift, ParticipantRoundOutput } from "../contracts/result.js";

type BuildBuiltinReportInput = {
  includeDeliberationTrace: boolean;
  traceLevel: "compact" | "full";
  status: "consensus" | "partial_consensus" | "unresolved" | "failed" | "interrupted";
  representativeSpeech: string;
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>;
  representativeId: string;
  finalClaims: Claim[];
  claimResolutions: ClaimResolution[];
};

export function buildBuiltinReport(input: BuildBuiltinReportInput): FinalReport {
  const shifts = input.includeDeliberationTrace ? buildOpinionShiftTimeline(input.rounds) : undefined;

  const roundHighlights = input.includeDeliberationTrace
    ? buildRoundHighlights(input.rounds, input.traceLevel)
    : undefined;

  return {
    mode: "builtin",
    traceIncluded: input.includeDeliberationTrace,
    traceLevel: input.traceLevel,
    finalSummary: buildFinalSummary(input),
    representativeSpeech: input.representativeSpeech,
    opinionShiftTimeline: shifts,
    roundHighlights
  };
}

function buildFinalSummary(input: BuildBuiltinReportInput): string {
  const statusLabel =
    input.status === "consensus"
      ? "Consensus reached"
      : input.status === "partial_consensus"
        ? "Partial consensus"
        : input.status === "unresolved"
          ? "Unresolved"
          : input.status === "interrupted"
            ? "Discussion interrupted"
            : "Failed";

  const lastRound = input.rounds.length > 0 ? input.rounds.reduce((a, b) => (a.round > b.round ? a : b)) : undefined;

  if (!lastRound || lastRound.outputs.length === 0) {
    return `${statusLabel}.`;
  }

  const summaries = lastRound.outputs.map((o) => `**${o.participantId}**: ${singleLine(o.summary)}`);
  return `${statusLabel}.\n\n${summaries.join("\n\n")}`;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildOpinionShiftTimeline(
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>
): OpinionShift[] {
  const lastStance = new Map<string, "agree" | "disagree" | "revise">();
  const timeline: OpinionShift[] = [];

  for (const roundRecord of [...rounds].sort((a, b) => a.round - b.round)) {
    for (const output of roundRecord.outputs) {
      for (const judgement of output.judgements) {
        const key = `${output.participantId}::${judgement.claimId}`;
        const previous = lastStance.get(key);
        if (!previous || previous !== judgement.stance) {
          timeline.push({
            claimId: judgement.claimId,
            participantId: output.participantId,
            from: previous ?? "unknown",
            to: judgement.stance,
            round: roundRecord.round,
            reason: judgement.rationale
          });
          lastStance.set(key, judgement.stance);
        }
      }
    }
  }

  return timeline;
}

function buildRoundHighlights(
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>,
  level: "compact" | "full"
): FinalReport["roundHighlights"] {
  const highlights: Array<{ round: number; participantId: string; summary: string }> = [];
  const limit = level === "compact" ? 140 : 280;

  for (const round of rounds) {
    for (const output of round.outputs) {
      highlights.push({
        round: round.round,
        participantId: output.participantId,
        summary: truncate(output.summary, limit)
      });
    }
  }

  return highlights;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}
