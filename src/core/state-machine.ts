export type ArgueSessionState = "created" | "running" | "finalizing" | "finished" | "failed";

const ALLOWED_TRANSITIONS: Record<ArgueSessionState, ArgueSessionState[]> = {
  created: ["running", "failed"],
  running: ["finalizing", "failed"],
  finalizing: ["finished", "failed"],
  finished: [],
  failed: []
};

export class ArgueStateMachine {
  private state: ArgueSessionState = "created";

  get current(): ArgueSessionState {
    return this.state;
  }

  transition(next: ArgueSessionState): void {
    if (!ALLOWED_TRANSITIONS[this.state].includes(next)) {
      throw new Error(`Invalid session state transition: ${this.state} -> ${next}`);
    }
    this.state = next;
  }
}
