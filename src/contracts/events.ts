export type ArgueEventType =
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

export type ArgueEvent = {
  sessionId: string;
  requestId: string;
  type: ArgueEventType;
  at: string;
  payload?: Record<string, unknown>;
};
