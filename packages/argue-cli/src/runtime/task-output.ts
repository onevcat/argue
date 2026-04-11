import {
  ActionTaskResultSchema,
  AgentTaskResultSchema,
  DebateRoundTaskOutputContentSchema,
  FinalVoteTaskOutputContentSchema,
  InitialRoundTaskOutputContentSchema,
  ReportOutputContentJsonSchema,
  ReportTaskOutputContentSchema,
  getRoundOutputContentJsonSchema,
  type AgentTaskInput,
  type AgentTaskResult,
  type ReportTaskInput,
  type RoundTaskInput
} from "@onevcat/argue";
import { z } from "zod";
import { parseJsonObject } from "./json.js";

type TaskContent = AgentTaskResult | z.infer<typeof InitialRoundTaskOutputContentSchema>;

export function getTaskOutputJsonSchema(task: AgentTaskInput): Record<string, unknown> {
  if (task.kind === "action") {
    return {}; // no schema enforcement for action
  }

  if (task.kind === "report") {
    return ReportOutputContentJsonSchema;
  }

  return getRoundOutputContentJsonSchema(task.phase);
}

export function normalizeTaskOutput(task: AgentTaskInput, candidate: unknown): AgentTaskResult {
  const wrapped = AgentTaskResultSchema.safeParse(candidate);
  if (wrapped.success) {
    assertWrappedOutputMatchesTask(task, wrapped.data);
    return wrapped.data;
  }

  if (task.kind === "action") {
    const structured = ActionTaskResultSchema.safeParse({
      kind: "action",
      output: candidate
    });
    if (structured.success) {
      return structured.data;
    }

    const text = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
    return {
      kind: "action",
      output: {
        fullResponse: text,
        summary: text.length > 200 ? text.slice(0, 200) + "..." : text
      }
    };
  }

  if (task.kind === "report") {
    const content = ReportTaskOutputContentSchema.parse(candidate);
    return {
      kind: "report",
      output: content
    };
  }

  const roundContent = getRoundContentSchema(task).parse(candidate);
  return {
    kind: "round",
    output: {
      participantId: task.participantId,
      phase: task.phase,
      round: task.round,
      ...roundContent
    }
  };
}

export function normalizeTaskOutputFromText(task: AgentTaskInput, text: string): AgentTaskResult {
  if (task.kind === "action") {
    return {
      kind: "action",
      output: {
        fullResponse: text,
        summary: text.length > 200 ? text.slice(0, 200) + "..." : text
      }
    };
  }

  return normalizeTaskOutput(task, parseJsonObject(text));
}

function assertWrappedOutputMatchesTask(task: AgentTaskInput, result: AgentTaskResult): void {
  if (task.kind !== result.kind) {
    throw new Error(`Task/result kind mismatch: expected ${task.kind}, got ${result.kind}`);
  }

  if (task.kind === "report") {
    return;
  }

  if (task.kind === "action") {
    return;
  }

  const roundResult = result.kind === "round" ? result : null;
  if (!roundResult) {
    throw new Error("Expected round result");
  }

  if (roundResult.output.participantId !== task.participantId) {
    throw new Error(
      `Round output participant mismatch: expected ${task.participantId}, got ${roundResult.output.participantId}`
    );
  }

  if (roundResult.output.phase !== task.phase) {
    throw new Error(`Round output phase mismatch: expected ${task.phase}, got ${roundResult.output.phase}`);
  }

  if (roundResult.output.round !== task.round) {
    throw new Error(`Round output round mismatch: expected ${task.round}, got ${roundResult.output.round}`);
  }
}

function getRoundContentSchema(task: RoundTaskInput): z.ZodTypeAny {
  if (task.phase === "initial") {
    return InitialRoundTaskOutputContentSchema;
  }

  if (task.phase === "debate") {
    return DebateRoundTaskOutputContentSchema;
  }

  return FinalVoteTaskOutputContentSchema;
}

export type { TaskContent, ReportTaskInput, RoundTaskInput };
