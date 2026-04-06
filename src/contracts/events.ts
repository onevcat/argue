export type ArgueEventType =
  | "SessionStarted"
  | "RoundDispatched"
  | "ParticipantResponded"
  | "RoundCompleted"
  | "ConsensusDrafted"
  | "Finalized"
  | "Failed";

export type ArgueEvent = {
  sessionId: string;
  requestId: string;
  type: ArgueEventType;
  at: string;
  payload?: Record<string, unknown>;
};
