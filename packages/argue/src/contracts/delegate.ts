import type { ArgueStartInput } from "./request.js";
import type { ParticipantRoundOutput } from "./result.js";
import type { AgentTaskInput, AgentTaskResult } from "./task.js";
import type { ArgueEvent } from "./events.js";

export interface AgentTaskDelegate {
  dispatch(task: AgentTaskInput): Promise<{
    taskId: string;
    participantId: string;
    kind: AgentTaskInput["kind"];
  }>;

  awaitResult(
    taskId: string,
    timeoutMs?: number
  ): Promise<{
    ok: boolean;
    output?: AgentTaskResult;
    error?: string;
  }>;

  cancel?(taskId: string): Promise<void>;
}

export interface ArgueObserver {
  onEvent(event: ArgueEvent): Promise<void> | void;
}

export interface SessionStore {
  save(session: unknown): Promise<void>;
  load(sessionId: string): Promise<unknown | null>;
  update(sessionId: string, patch: unknown): Promise<void>;
}

export interface WaitCoordinator {
  waitRound(args: {
    round: number;
    taskIds: string[];
    policy: NonNullable<ArgueStartInput["waitingPolicy"]>;
    onTaskSettled?: (event: {
      taskId: string;
      status: "completed" | "failed" | "timeout";
      at: string;
      output?: ParticipantRoundOutput;
      error?: string;
    }) => Promise<void> | void;
  }): Promise<{
    completed: ParticipantRoundOutput[];
    timedOutTaskIds: string[];
    failedTaskIds: string[];
  }>;
}
