import { z } from "zod";

export const ArgueEventTypeSchema = z.enum([
  "SessionStarted",
  "RoundDispatched",
  "ParticipantResponded",
  "ParticipantEliminated",
  "ClaimsMerged",
  "RoundCompleted",
  "EarlyStopTriggered",
  "GlobalDeadlineHit",
  "ConsensusDrafted",
  "ReportDispatched",
  "ReportCompleted",
  "ActionDispatched",
  "ActionCompleted",
  "ActionFailed",
  "SessionInterrupted",
  "Finalized",
  "Failed"
]);

export type ArgueEventType = z.infer<typeof ArgueEventTypeSchema>;

export const ArgueEventSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  type: ArgueEventTypeSchema,
  at: z.string().min(1),
  payload: z.record(z.unknown()).optional()
});

export type ArgueEvent = z.infer<typeof ArgueEventSchema>;
