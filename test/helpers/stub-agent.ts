import type { AgentTaskDelegate } from "../../src/contracts/delegate.js";
import type { AgentTaskInput, AgentTaskResult } from "../../src/contracts/task.js";

type Scenario =
  | { type: "success"; output: AgentTaskResult; delayMs?: number }
  | { type: "fail"; error: string; delayMs?: number }
  | { type: "timeout" };

function keyOf(task: AgentTaskInput): string {
  if (task.kind === "round") {
    return `round:${task.phase}:${task.round}:${task.participantId}`;
  }
  return `report:${task.participantId}`;
}

export class StubAgentTaskDelegate implements AgentTaskDelegate {
  private seq = 0;
  private readonly taskScenario = new Map<string, Scenario>();
  readonly dispatchCalls: AgentTaskInput[] = [];
  readonly canceledTaskIds: string[] = [];

  constructor(private readonly scenarioByKey: Record<string, Scenario>) {}

  async dispatch(task: AgentTaskInput): Promise<{ taskId: string; participantId: string; kind: AgentTaskInput["kind"] }> {
    this.dispatchCalls.push(task);
    const key = keyOf(task);
    const scenario = this.scenarioByKey[key];
    if (!scenario) {
      throw new Error(`No scenario configured for ${key}`);
    }

    const taskId = `${key}#${this.seq++}`;
    this.taskScenario.set(taskId, scenario);
    return { taskId, participantId: task.participantId, kind: task.kind };
  }

  async awaitResult(taskId: string): Promise<{ ok: boolean; output?: AgentTaskResult; error?: string }> {
    const scenario = this.taskScenario.get(taskId);
    if (!scenario) {
      return { ok: false, error: `unknown_task_id:${taskId}` };
    }

    if (scenario.type === "timeout") {
      return new Promise(() => {});
    }

    if (scenario.delayMs && scenario.delayMs > 0) {
      await delay(scenario.delayMs);
    }

    if (scenario.type === "fail") {
      return { ok: false, error: scenario.error };
    }

    return { ok: true, output: scenario.output };
  }

  async cancel(taskId: string): Promise<void> {
    this.canceledTaskIds.push(taskId);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
