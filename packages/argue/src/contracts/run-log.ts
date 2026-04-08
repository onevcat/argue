import { z } from "zod";
import { ArgueEventSchema } from "./events.js";

export const JSONL_RUN_EVENT_VERSION = 1 as const;

export const JsonlRunEventSchema = z.object({
  v: z.literal(JSONL_RUN_EVENT_VERSION),
  kind: z.literal("argue.event"),
  seq: z.number().int().nonnegative(),
  loggedAt: z.string().min(1),
  event: ArgueEventSchema
});

export type JsonlRunEvent = z.infer<typeof JsonlRunEventSchema>;
