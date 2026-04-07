import type { ArgueStartInput } from "./request.js";
import type { ParticipantRoundOutput } from "./result.js";
import type { AgentTaskInput, AgentTaskResult } from "./task.js";

export interface AgentTaskDelegate {
  dispatch(task: AgentTaskInput): Promise<{
    taskId: string;
    participantId: string;
    kind: AgentTaskInput["kind"];
  }>;

  awaitResult(taskId: string, timeoutMs?: number): Promise<{
    ok: boolean;
    output?: AgentTaskResult;
    error?: string;
  }>;

  cancel?(taskId: string): Promise<void>;
}

export interface ArgueObserver {
  onEvent(event: {
    sessionId: string;
    requestId: string;
    type:
      | "SessionStarted"
      | "RoundDispatched"
      | "ParticipantResponded"
      | "ParticipantEliminated"
      | "ClaimsMerged"
      | "RoundCompleted"
      | "EarlyStopTriggered"
      | "GlobalDeadlineHit"
      | "ConsensusDrafted"
      | "Finalized"
      | "Failed";
    at: string;
    payload?: Record<string, unknown>;
  }): Promise<void> | void;
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
  }): Promise<{
    completed: ParticipantRoundOutput[];
    timedOutTaskIds: string[];
    failedTaskIds: string[];
  }>;
}
