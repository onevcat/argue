import { z } from "zod";

export const ClaimCategorySchema = z.enum(["pro", "con", "risk", "tradeoff", "todo"]);

export const ClaimSchema = z.object({
  claimId: z.string().min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  category: ClaimCategorySchema.optional()
});

export type Claim = z.infer<typeof ClaimSchema>;

export const ClaimStanceSchema = z.enum(["agree", "disagree", "revise"]);
export type ClaimStance = z.infer<typeof ClaimStanceSchema>;

export const ClaimJudgementSchema = z.object({
  claimId: z.string().min(1),
  stance: ClaimStanceSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  revisedStatement: z.string().min(1).optional()
});

export type ClaimJudgement = z.infer<typeof ClaimJudgementSchema>;

export const PhaseSchema = z.enum(["initial", "debate", "final_vote"]);
export type Phase = z.infer<typeof PhaseSchema>;

export const ParticipantRoundOutputSchema = z.object({
  participantId: z.string().min(1),
  phase: PhaseSchema,
  round: z.number().int().min(0),
  fullResponse: z.string().min(1),
  extractedClaims: z.array(ClaimSchema).optional(),
  judgements: z.array(ClaimJudgementSchema),
  selfScore: z.number().min(0).max(100).optional(),
  vote: z.enum(["accept", "reject"]).optional(),
  summary: z.string().min(1)
});

export type ParticipantRoundOutput = z.infer<typeof ParticipantRoundOutputSchema>;

export const ParticipantScoreSchema = z.object({
  participantId: z.string().min(1),
  total: z.number(),
  byRound: z.array(z.object({
    round: z.number().int().min(0),
    score: z.number()
  })),
  breakdown: z.object({
    correctness: z.number().optional(),
    completeness: z.number().optional(),
    actionability: z.number().optional(),
    consistency: z.number().optional()
  }).optional()
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

export const FinalReportSchema = z.object({
  mode: z.enum(["builtin", "delegate-agent"]),
  traceIncluded: z.boolean(),
  traceLevel: z.enum(["compact", "full"]),
  finalSummary: z.string().min(1),
  representativeSpeech: z.string().min(1),
  opinionShiftTimeline: z.array(OpinionShiftSchema).optional(),
  roundHighlights: z.array(z.object({
    round: z.number().int().min(0),
    participantId: z.string().min(1),
    summary: z.string().min(1)
  })).optional()
});

export type FinalReport = z.infer<typeof FinalReportSchema>;

export const ArgueResultSchema = z.object({
  requestId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["consensus", "unresolved", "failed"]),
  finalClaims: z.array(ClaimSchema),
  representative: z.object({
    participantId: z.string().min(1),
    reason: z.enum(["top-score", "tie-breaker"]),
    score: z.number(),
    speech: z.string().min(1)
  }),
  scoreboard: z.array(ParticipantScoreSchema),
  votes: z.array(z.object({
    participantId: z.string().min(1),
    vote: z.enum(["accept", "reject"]),
    reason: z.string().optional()
  })),
  report: FinalReportSchema,
  disagreements: z.array(z.object({
    claimId: z.string().min(1),
    participantId: z.string().min(1),
    reason: z.string().min(1)
  })).optional(),
  rounds: z.array(z.object({
    round: z.number().int().min(0),
    outputs: z.array(ParticipantRoundOutputSchema)
  })),
  metrics: z.object({
    elapsedMs: z.number().int().nonnegative(),
    totalTurns: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    waitTimeouts: z.number().int().nonnegative()
  }),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1)
  }).optional()
});

export type ArgueResult = z.infer<typeof ArgueResultSchema>;
