import { describe, expect, it } from "vitest";
import { ArgueStateMachine } from "../src/core/state-machine.js";

describe("ArgueStateMachine", () => {
  it("allows legal state transitions", () => {
    const machine = new ArgueStateMachine();

    expect(machine.current).toBe("created");
    machine.transition("running");
    machine.transition("finalizing");
    machine.transition("finished");

    expect(machine.current).toBe("finished");
  });

  it("rejects illegal transitions", () => {
    const machine = new ArgueStateMachine();

    expect(() => machine.transition("finished")).toThrow(/Invalid session state transition/);

    machine.transition("running");
    expect(() => machine.transition("created")).toThrow(/running -> created/);
  });
});
