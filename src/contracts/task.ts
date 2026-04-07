import { z } from "zod";
import { ClaimSchema, PhaseSchema } from "./result.js";

export const RoundTaskInputSchema = z.object({
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
  claimCatalog: z.array(ClaimSchema).optional(),
  metadata: z.record(z.unknown()).optional()
});

export type RoundTaskInput = z.infer<typeof RoundTaskInputSchema>;
