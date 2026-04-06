import type { ArgueStartInput } from "./request.js";
import type { FinalReport, ParticipantRoundOutput, ParticipantScore } from "./result.js";
import type { RoundTaskInput } from "./task.js";

export interface AgentTaskDelegate {
  dispatch(task: RoundTaskInput): Promise<{ taskId: string; participantId: string }>;
  awaitResult(taskId: string, timeoutMs?: number): Promise<{
    ok: boolean;
    output?: ParticipantRoundOutput;
    error?: string;
  }>;
  cancel?(taskId: string): Promise<void>;
}

export interface ReportComposerDelegate {
  compose(input: {
    requestId: string;
    sessionId: string;
    representative: {
      participantId: string;
      speech: string;
      score: number;
    };
    rounds: Array<{
      round: number;
      outputs: ParticipantRoundOutput[];
    }>;
    votes: Array<{
      participantId: string;
      vote: "accept" | "reject";
      reason?: string;
    }>;
    scoreboard: ParticipantScore[];
    policy: NonNullable<ArgueStartInput["reportPolicy"]>;
  }): Promise<FinalReport>;
}

export interface ArgueObserver {
  onEvent(event: {
    sessionId: string;
    requestId: string;
    type:
      | "SessionStarted"
      | "RoundDispatched"
      | "ParticipantResponded"
      | "RoundCompleted"
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
