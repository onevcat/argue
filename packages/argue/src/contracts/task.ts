import { z } from "zod";
import { ClaimResolutionSchema, ClaimSchema, FinalReportSchema, PhaseSchema, ParticipantRoundOutputSchema, ParticipantScoreSchema } from "./result.js";

const ClaimDraftSchema = ClaimSchema.pick({
  claimId: true,
  title: true,
  statement: true,
  category: true,
  proposedBy: true,
  status: true,
  mergedInto: true
});

export const RoundTaskInputSchema = z.object({
  kind: z.literal("round"),
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  participantId: z.string().min(1),
  phase: PhaseSchema,
  round: z.number().int().min(0),
  prompt: z.string().min(1),
  selfHistoryRef: z.object({
    stickySession: z.literal(true)
  }).optional(),
  peerRoundInputs: z.array(z.object({
    participantId: z.string().min(1),
    round: z.number().int().min(0),
    fullResponse: z.string().min(1),
    truncated: z.boolean().optional()
  })).optional(),
  claimCatalog: z.array(ClaimDraftSchema).optional(),
  metadata: z.record(z.unknown()).optional()
});

export type RoundTaskInput = z.infer<typeof RoundTaskInputSchema>;

export const ReportTaskInputSchema = z.object({
  kind: z.literal("report"),
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  participantId: z.string().min(1),
  prompt: z.string().min(1),
  reportInput: z.object({
    status: z.enum(["consensus", "partial_consensus", "unresolved", "failed"]),
    representative: z.object({
      participantId: z.string().min(1),
      speech: z.string().min(1),
      score: z.number()
    }),
    finalClaims: z.array(ClaimSchema),
    claimResolutions: z.array(ClaimResolutionSchema),
    scoreboard: z.array(ParticipantScoreSchema),
    rounds: z.array(z.object({
      round: z.number().int().min(0),
      outputs: z.array(ParticipantRoundOutputSchema)
    }))
  }),
  metadata: z.record(z.unknown()).optional()
});

export type ReportTaskInput = z.infer<typeof ReportTaskInputSchema>;

export const AgentTaskInputSchema = z.discriminatedUnion("kind", [
  RoundTaskInputSchema,
  ReportTaskInputSchema
]);

export type AgentTaskInput = z.infer<typeof AgentTaskInputSchema>;

export const RoundTaskResultSchema = z.object({
  kind: z.literal("round"),
  output: ParticipantRoundOutputSchema
});

export type RoundTaskResult = z.infer<typeof RoundTaskResultSchema>;

export const ReportTaskResultSchema = z.object({
  kind: z.literal("report"),
  output: FinalReportSchema
});

export type ReportTaskResult = z.infer<typeof ReportTaskResultSchema>;

export const AgentTaskResultSchema = z.discriminatedUnion("kind", [
  RoundTaskResultSchema,
  ReportTaskResultSchema
]);

export type AgentTaskResult = z.infer<typeof AgentTaskResultSchema>;
