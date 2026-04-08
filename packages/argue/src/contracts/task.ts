import { z } from "zod";
import {
  ClaimJudgementSchema,
  ClaimResolutionSchema,
  ClaimSchema,
  ClaimVoteInputSchema,
  FinalReportSchema,
  PhaseSchema,
  ParticipantRoundOutputSchema,
  ParticipantScoreSchema
} from "./result.js";

const ClaimDraftSchema = ClaimSchema.pick({
  claimId: true,
  title: true,
  statement: true,
  category: true,
  proposedBy: true,
  status: true,
  mergedInto: true
});

const ExtractedClaimOutputSchema = ClaimSchema.pick({
  claimId: true,
  title: true,
  statement: true,
  category: true
});

export const InitialRoundTaskOutputContentSchema = z.object({
  fullResponse: z.string().min(1),
  summary: z.string().min(1),
  extractedClaims: z.array(ExtractedClaimOutputSchema),
  judgements: z.array(ClaimJudgementSchema)
});

export const DebateRoundTaskOutputContentSchema = z.object({
  fullResponse: z.string().min(1),
  summary: z.string().min(1),
  extractedClaims: z.array(ExtractedClaimOutputSchema).optional(),
  judgements: z.array(ClaimJudgementSchema).min(1)
});

export const FinalVoteTaskOutputContentSchema = z.object({
  fullResponse: z.string().min(1),
  summary: z.string().min(1),
  judgements: z.array(ClaimJudgementSchema),
  claimVotes: z.array(ClaimVoteInputSchema).min(1)
});

export const ReportTaskOutputContentSchema = FinalReportSchema;

export type RoundOutputContentSchemaRef =
  | "argue.round.initial.output-content.v1"
  | "argue.round.debate.output-content.v1"
  | "argue.round.final_vote.output-content.v1";

export const ROUND_OUTPUT_CONTENT_SCHEMA_REF: Record<z.infer<typeof PhaseSchema>, RoundOutputContentSchemaRef> = {
  initial: "argue.round.initial.output-content.v1",
  debate: "argue.round.debate.output-content.v1",
  final_vote: "argue.round.final_vote.output-content.v1"
};

export const REPORT_OUTPUT_CONTENT_SCHEMA_REF = "argue.report.output-content.v1" as const;

const CLAIM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claimId", "title", "statement"],
  properties: {
    claimId: { type: "string" },
    title: { type: "string" },
    statement: { type: "string" },
    category: { type: "string", enum: ["pro", "con", "risk", "tradeoff", "todo"] }
  }
} as const;

const CLAIM_JUDGEMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claimId", "stance", "confidence", "rationale"],
  properties: {
    claimId: { type: "string" },
    stance: { type: "string", enum: ["agree", "disagree", "revise"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" },
    revisedStatement: { type: "string" },
    mergesWith: { type: "string" }
  }
} as const;

export const InitialRoundOutputContentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "ArgueInitialRoundOutputContentV1",
  type: "object",
  additionalProperties: false,
  required: ["fullResponse", "summary", "extractedClaims", "judgements"],
  properties: {
    fullResponse: { type: "string" },
    summary: { type: "string" },
    extractedClaims: {
      type: "array",
      items: CLAIM_JSON_SCHEMA
    },
    judgements: {
      type: "array",
      items: CLAIM_JUDGEMENT_JSON_SCHEMA
    }
  }
} as const;

export const DebateRoundOutputContentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "ArgueDebateRoundOutputContentV1",
  type: "object",
  additionalProperties: false,
  required: ["fullResponse", "summary", "judgements"],
  properties: {
    fullResponse: { type: "string" },
    summary: { type: "string" },
    extractedClaims: {
      type: "array",
      items: CLAIM_JSON_SCHEMA
    },
    judgements: {
      type: "array",
      minItems: 1,
      items: CLAIM_JUDGEMENT_JSON_SCHEMA
    }
  }
} as const;

export const FinalVoteRoundOutputContentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "ArgueFinalVoteRoundOutputContentV1",
  type: "object",
  additionalProperties: false,
  required: ["fullResponse", "summary", "judgements", "claimVotes"],
  properties: {
    fullResponse: { type: "string" },
    summary: { type: "string" },
    judgements: {
      type: "array",
      items: CLAIM_JUDGEMENT_JSON_SCHEMA
    },
    claimVotes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claimId", "vote"],
        properties: {
          claimId: { type: "string" },
          vote: { type: "string", enum: ["accept", "reject"] },
          reason: { type: "string" }
        }
      }
    }
  }
} as const;

export const ReportOutputContentJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "ArgueReportOutputContentV1",
  type: "object",
  additionalProperties: false,
  required: ["mode", "traceIncluded", "traceLevel", "finalSummary", "representativeSpeech"],
  properties: {
    mode: { type: "string", enum: ["builtin", "representative"] },
    traceIncluded: { type: "boolean" },
    traceLevel: { type: "string", enum: ["compact", "full"] },
    finalSummary: { type: "string" },
    representativeSpeech: { type: "string" },
    opinionShiftTimeline: { type: "array" },
    roundHighlights: { type: "array" }
  }
} as const;

export function getRoundOutputContentSchemaRef(phase: z.infer<typeof PhaseSchema>): RoundOutputContentSchemaRef {
  return ROUND_OUTPUT_CONTENT_SCHEMA_REF[phase];
}

export function getRoundOutputContentJsonSchema(phase: z.infer<typeof PhaseSchema>): Record<string, unknown> {
  if (phase === "initial") return InitialRoundOutputContentJsonSchema;
  if (phase === "debate") return DebateRoundOutputContentJsonSchema;
  return FinalVoteRoundOutputContentJsonSchema;
}

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
