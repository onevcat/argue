import type { AgentTaskDelegate, ReportComposerDelegate } from "../../src/contracts/delegate.js";
import type { FinalReport, ParticipantRoundOutput, ParticipantScore } from "../../src/contracts/result.js";
import type { RoundTaskInput } from "../../src/contracts/task.js";

type Scenario =
  | { type: "success"; output: ParticipantRoundOutput; delayMs?: number }
  | { type: "fail"; error: string; delayMs?: number }
  | { type: "timeout" };

function keyOf(task: Pick<RoundTaskInput, "phase" | "round" | "participantId">): string {
  return `${task.phase}:${task.round}:${task.participantId}`;
}

export class StubAgentTaskDelegate implements AgentTaskDelegate {
  private seq = 0;
  private readonly taskScenario = new Map<string, Scenario>();
  readonly dispatchCalls: RoundTaskInput[] = [];
  readonly canceledTaskIds: string[] = [];

  constructor(private readonly scenarioByKey: Record<string, Scenario>) {}

  async dispatch(task: RoundTaskInput): Promise<{ taskId: string; participantId: string }> {
    this.dispatchCalls.push(task);
    const key = keyOf(task);
    const scenario = this.scenarioByKey[key];
    if (!scenario) {
      throw new Error(`No scenario configured for ${key}`);
    }

    const taskId = `${key}#${this.seq++}`;
    this.taskScenario.set(taskId, scenario);
    return { taskId, participantId: task.participantId };
  }

  async awaitResult(taskId: string): Promise<{ ok: boolean; output?: ParticipantRoundOutput; error?: string }> {
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

export class StubReportComposerDelegate implements ReportComposerDelegate {
  called = 0;

  constructor(
    private readonly factory: (input: {
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
      policy: {
        includeDeliberationTrace?: boolean;
        traceLevel?: "compact" | "full";
        composer?: "builtin" | "delegate-agent";
        reporterId?: string;
        maxReportChars?: number;
      };
    }) => FinalReport
  ) {}

  async compose(input: {
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
    policy: {
      includeDeliberationTrace?: boolean;
      traceLevel?: "compact" | "full";
      composer?: "builtin" | "delegate-agent";
      reporterId?: string;
      maxReportChars?: number;
    };
  }): Promise<FinalReport> {
    this.called += 1;
    return this.factory(input);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
