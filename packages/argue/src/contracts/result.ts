import { z } from "zod";

export const ClaimCategorySchema = z.enum(["pro", "con", "risk", "tradeoff", "todo"]);
export const ClaimStatusSchema = z.enum(["active", "merged", "withdrawn"]);

export const ClaimSchema = z.object({
  claimId: z.string().min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  category: ClaimCategorySchema.optional(),
  proposedBy: z.array(z.string().min(1)).min(1),
  status: ClaimStatusSchema.default("active"),
  mergedInto: z.string().min(1).optional()
});

export type Claim = z.infer<typeof ClaimSchema>;

export const ClaimStanceSchema = z.enum(["agree", "disagree", "revise"]);
export type ClaimStance = z.infer<typeof ClaimStanceSchema>;

export const ClaimJudgementSchema = z.object({
  claimId: z.string().min(1),
  stance: ClaimStanceSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  revisedStatement: z.string().min(1).optional(),
  mergesWith: z.string().min(1).optional()
});

export type ClaimJudgement = z.infer<typeof ClaimJudgementSchema>;

export const ClaimVoteSchema = z.object({
  participantId: z.string().min(1),
  claimId: z.string().min(1),
  vote: z.enum(["accept", "reject"]),
  reason: z.string().optional()
});

export const ClaimVoteInputSchema = ClaimVoteSchema.omit({ participantId: true });

export type ClaimVote = z.infer<typeof ClaimVoteSchema>;

export const PhaseSchema = z.enum(["initial", "debate", "final_vote"]);
export type Phase = z.infer<typeof PhaseSchema>;

/**
 * Maximum number of characters allowed for a task title. The value is
 * deliberately universal across scripts: agents are guided to aim for
 * around 30 CJK characters or around 60 Latin characters, but the
 * schema uses a single 60 code-unit ceiling so mixed-script titles do
 * not need branching validation.
 */
export const ARGUE_TASK_TITLE_MAX = 60 as const;

const ParticipantRoundOutputBaseSchema = z.object({
  participantId: z.string().min(1),
  round: z.number().int().min(0),
  fullResponse: z.string().min(1),
  extractedClaims: z
    .array(
      ClaimSchema.pick({
        title: true,
        statement: true,
        category: true
      }).extend({
        claimId: z.string().min(1).optional()
      })
    )
    .optional(),
  judgements: z.array(ClaimJudgementSchema),
  selfScore: z.number().min(0).max(100).optional(),
  summary: z.string().min(1),
  respondedAt: z.string().min(1).optional()
});

export const InitialParticipantRoundOutputSchema = ParticipantRoundOutputBaseSchema.extend({
  phase: z.literal("initial"),
  /**
   * Concise one-sentence title summarising the debate task. Required
   * in the initial phase only; the engine later selects the title
   * from the representative's initial output and promotes it to
   * result.task.title.
   */
  taskTitle: z.string().min(1).max(ARGUE_TASK_TITLE_MAX),
  claimVotes: z.undefined().optional()
});

export const DebateParticipantRoundOutputSchema = ParticipantRoundOutputBaseSchema.extend({
  phase: z.literal("debate"),
  claimVotes: z.undefined().optional()
});

export const FinalVoteParticipantRoundOutputSchema = ParticipantRoundOutputBaseSchema.extend({
  phase: z.literal("final_vote"),
  claimVotes: z.array(ClaimVoteInputSchema).min(1)
});

export const ParticipantRoundOutputSchema = z.discriminatedUnion("phase", [
  InitialParticipantRoundOutputSchema,
  DebateParticipantRoundOutputSchema,
  FinalVoteParticipantRoundOutputSchema
]);

export type ParticipantRoundOutput = z.infer<typeof ParticipantRoundOutputSchema>;

export const ParticipantScoreSchema = z.object({
  participantId: z.string().min(1),
  total: z.number(),
  byRound: z.array(
    z.object({
      round: z.number().int().min(0),
      score: z.number()
    })
  ),
  breakdown: z
    .object({
      correctness: z.number().optional(),
      completeness: z.number().optional(),
      actionability: z.number().optional(),
      consistency: z.number().optional()
    })
    .optional()
});

export type ParticipantScore = z.infer<typeof ParticipantScoreSchema>;

export const OpinionShiftSchema = z.object({
  claimId: z.string().min(1),
  participantId: z.string().min(1),
  from: z.enum(["agree", "disagree", "revise", "unknown"]),
  to: ClaimStanceSchema,
  round: z.number().int().min(0),
  reason: z.string().optional()
});

export type OpinionShift = z.infer<typeof OpinionShiftSchema>;

export const ClaimResolutionSchema = z.object({
  claimId: z.string().min(1),
  status: z.enum(["resolved", "unresolved"]),
  acceptCount: z.number().int().nonnegative(),
  rejectCount: z.number().int().nonnegative(),
  totalVoters: z.number().int().nonnegative(),
  votes: z.array(ClaimVoteSchema)
});

export type ClaimResolution = z.infer<typeof ClaimResolutionSchema>;

export const FinalReportSchema = z.object({
  mode: z.enum(["builtin", "representative"]),
  traceIncluded: z.boolean(),
  traceLevel: z.enum(["compact", "full"]),
  finalSummary: z.string().min(1),
  representativeSpeech: z.string().min(1),
  opinionShiftTimeline: z.array(OpinionShiftSchema).optional(),
  roundHighlights: z
    .array(
      z.object({
        round: z.number().int().min(0),
        participantId: z.string().min(1),
        summary: z.string().min(1)
      })
    )
    .optional()
});

export type FinalReport = z.infer<typeof FinalReportSchema>;

export const EliminationRecordSchema = z.object({
  participantId: z.string().min(1),
  round: z.number().int().min(0),
  reason: z.enum(["timeout", "error"]),
  at: z.string().min(1)
});

export type EliminationRecord = z.infer<typeof EliminationRecordSchema>;

export const RoundAppliedMergeSchema = z.object({
  sourceClaimId: z.string().min(1),
  targetClaimId: z.string().min(1),
  participantIds: z.array(z.string().min(1)).min(1)
});

export type RoundAppliedMerge = z.infer<typeof RoundAppliedMergeSchema>;

export const RoundRecordSchema = z.object({
  round: z.number().int().min(0),
  outputs: z.array(ParticipantRoundOutputSchema),
  appliedMerges: z.array(RoundAppliedMergeSchema).optional()
});

export type RoundRecord = z.infer<typeof RoundRecordSchema>;

export const ActionOutputSchema = z.object({
  actorId: z.string().min(1),
  status: z.enum(["completed", "failed"]),
  fullResponse: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  error: z.string().min(1).optional()
});
export type ActionOutput = z.infer<typeof ActionOutputSchema>;

/**
 * A debate task as surfaced in the final result. `prompt` is the
 * original user-supplied task string; `title` is a concise one-line
 * summary chosen from the representative participant's initial round
 * output so downstream UIs (viewer, CLI summary) can show a readable
 * headline without truncating the full prompt.
 */
export const TaskSchema = z.object({
  prompt: z.string().min(1),
  title: z.string().min(1).max(ARGUE_TASK_TITLE_MAX)
});
export type Task = z.infer<typeof TaskSchema>;

export const ARGUE_RESULT_VERSION = 1 as const;

export const ArgueResultSchema = z.object({
  resultVersion: z.literal(ARGUE_RESULT_VERSION),
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  task: TaskSchema,
  status: z.enum(["consensus", "partial_consensus", "unresolved", "failed"]),
  finalClaims: z.array(ClaimSchema),
  claimResolutions: z.array(ClaimResolutionSchema),
  representative: z.object({
    participantId: z.string().min(1),
    reason: z.enum(["top-score", "tie-breaker", "host-designated"]),
    score: z.number(),
    speech: z.string().min(1)
  }),
  scoreboard: z.array(ParticipantScoreSchema),
  eliminations: z.array(EliminationRecordSchema),
  report: FinalReportSchema,
  disagreements: z
    .array(
      z.object({
        claimId: z.string().min(1),
        participantId: z.string().min(1),
        reason: z.string().min(1)
      })
    )
    .optional(),
  rounds: z.array(RoundRecordSchema),
  metrics: z.object({
    elapsedMs: z.number().int().nonnegative(),
    totalRounds: z.number().int().nonnegative(),
    totalTurns: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    waitTimeouts: z.number().int().nonnegative(),
    earlyStopTriggered: z.boolean(),
    globalDeadlineHit: z.boolean()
  }),
  action: ActionOutputSchema.optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1)
    })
    .optional()
});

export type ArgueResult = z.infer<typeof ArgueResultSchema>;
