import { z } from "zod";

export const ParticipantInputSchema = z.object({
  id: z.string().min(1),
  role: z.string().optional()
});

export const ArgueStartInputSchema = z
  .object({
    requestId: z.string().min(1),
    task: z.string().min(1),
    participants: z.array(ParticipantInputSchema).min(2),

    participantsPolicy: z
      .object({
        minParticipants: z.number().int().min(2).default(2),
        onInsufficientParticipants: z.enum(["interrupt", "fail"]).default("interrupt")
      })
      .default({ minParticipants: 2, onInsufficientParticipants: "interrupt" }),

    roundPolicy: z
      .object({
        minRounds: z.number().int().min(0).default(2),
        maxRounds: z.number().int().min(1).default(3)
      })
      .default({ minRounds: 2, maxRounds: 3 }),

    sessionPolicy: z
      .object({
        mode: z.literal("sticky-per-participant").default("sticky-per-participant"),
        sessionKeyPrefix: z.string().min(1).optional()
      })
      .default({ mode: "sticky-per-participant" }),

    peerContextPolicy: z
      .object({
        passMode: z.literal("full-response-preferred").default("full-response-preferred"),
        maxCharsPerPeerResponse: z.number().int().min(200).default(6000),
        maxPeersPerRound: z.number().int().min(1).default(10),
        overflowStrategy: z.enum(["truncate-tail", "truncate-middle"]).default("truncate-tail")
      })
      .default({
        passMode: "full-response-preferred",
        maxCharsPerPeerResponse: 6000,
        overflowStrategy: "truncate-tail"
      }),

    scoringPolicy: z
      .object({
        enabled: z.literal(true).default(true),
        representativeSelection: z.literal("top-score").default("top-score"),
        tieBreaker: z.enum(["latest-round-score", "least-objection"]).default("latest-round-score"),
        rubric: z
          .object({
            correctness: z.number().min(0).max(1).default(0.35),
            completeness: z.number().min(0).max(1).default(0.25),
            actionability: z.number().min(0).max(1).default(0.25),
            consistency: z.number().min(0).max(1).default(0.15)
          })
          .default({
            correctness: 0.35,
            completeness: 0.25,
            actionability: 0.25,
            consistency: 0.15
          })
      })
      .default({
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        rubric: {
          correctness: 0.35,
          completeness: 0.25,
          actionability: 0.25,
          consistency: 0.15
        }
      }),

    consensusPolicy: z
      .object({
        threshold: z.number().min(0).max(1).default(1)
      })
      .default({ threshold: 1 }),

    reportPolicy: z
      .object({
        includeDeliberationTrace: z.boolean().default(false),
        traceLevel: z.enum(["compact", "full"]).default("compact"),
        composer: z.enum(["builtin", "representative"]).default("builtin"),
        representativeId: z.string().min(1).optional()
      })
      .strict()
      .default({
        includeDeliberationTrace: false,
        traceLevel: "compact",
        composer: "builtin"
      }),

    actionPolicy: z
      .object({
        prompt: z.string().min(1),
        actorId: z.string().min(1).optional(),
        includeFullResult: z.boolean().default(true)
      })
      .strict()
      .optional(),

    promptPolicy: z
      .object({
        debateTemplate: z.string().min(1).optional(),
        reportTemplate: z.string().min(1).optional()
      })
      .optional(),

    waitingPolicy: z
      .object({
        // Default matches perRoundTimeoutMs: in a concurrent round the round
        // cap already bounds the effective wait. perTask only has independent
        // effect when explicitly set below it, which stays opt-in.
        perTaskTimeoutMs: z
          .number()
          .int()
          .min(1_000)
          .default(20 * 60 * 1_000),
        perRoundTimeoutMs: z
          .number()
          .int()
          .min(1_000)
          .default(20 * 60 * 1_000),
        globalDeadlineMs: z.number().int().min(1_000).optional()
      })
      .strict()
      .default({
        perTaskTimeoutMs: 20 * 60 * 1_000,
        perRoundTimeoutMs: 20 * 60 * 1_000
      }),

    constraints: z
      .object({
        language: z.string().min(1).optional(),
        tokenBudgetHint: z.number().int().positive().optional()
      })
      .optional(),

    context: z.record(z.unknown()).optional()
  })
  .superRefine((input, ctx) => {
    if (input.roundPolicy.maxRounds < input.roundPolicy.minRounds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "roundPolicy.maxRounds must be >= roundPolicy.minRounds",
        path: ["roundPolicy", "maxRounds"]
      });
    }

    if (input.participants.length < input.participantsPolicy.minParticipants) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "participants length must be >= participantsPolicy.minParticipants",
        path: ["participants"]
      });
    }
  });

export type ArgueStartInput = z.input<typeof ArgueStartInputSchema>;
export type NormalizedArgueStartInput = z.output<typeof ArgueStartInputSchema>;

export function normalizeStartInput(input: unknown): NormalizedArgueStartInput {
  return ArgueStartInputSchema.parse(input);
}
