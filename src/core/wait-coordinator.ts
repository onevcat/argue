import type { AgentTaskDelegate, WaitCoordinator } from "../contracts/delegate.js";
import type { ArgueStartInput } from "../contracts/request.js";
import { ParticipantRoundOutputSchema, type ParticipantRoundOutput } from "../contracts/result.js";

export class DefaultWaitCoordinator implements WaitCoordinator {
  constructor(private readonly delegate: AgentTaskDelegate) {}

  async waitRound(args: {
    round: number;
    taskIds: string[];
    policy: NonNullable<ArgueStartInput["waitingPolicy"]>;
  }): Promise<{
    completed: ParticipantRoundOutput[];
    timedOutTaskIds: string[];
    failedTaskIds: string[];
  }> {
    const states = new Map<string, {
      done: boolean;
      ok?: boolean;
      output?: ParticipantRoundOutput;
      error?: string;
    }>();

    for (const taskId of args.taskIds) {
      states.set(taskId, { done: false });
    }

    let finishedCount = 0;
    let resolveAllDone: (() => void) | undefined;
    const allDone = new Promise<void>((resolve) => {
      resolveAllDone = resolve;
    });

    for (const taskId of args.taskIds) {
      void this.delegate.awaitResult(taskId, args.policy.perTaskTimeoutMs)
        .then((result) => {
          const current = states.get(taskId);
          if (!current || current.done) return;

          if (result.ok && result.output) {
            const parsed = ParticipantRoundOutputSchema.parse(result.output);
            states.set(taskId, { done: true, ok: true, output: parsed });
          } else {
            states.set(taskId, { done: true, ok: false, error: result.error ?? "unknown_error" });
          }
        })
        .catch((error) => {
          const current = states.get(taskId);
          if (!current || current.done) return;
          states.set(taskId, { done: true, ok: false, error: String(error) });
        })
        .finally(() => {
          finishedCount += 1;
          if (finishedCount === args.taskIds.length) {
            resolveAllDone?.();
          }
        });
    }

    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), args.policy.perRoundTimeoutMs);
    });

    await Promise.race([allDone, timeoutPromise]);

    const completed: ParticipantRoundOutput[] = [];
    const timedOutTaskIds: string[] = [];
    const failedTaskIds: string[] = [];

    for (const taskId of args.taskIds) {
      const state = states.get(taskId);
      if (!state || !state.done) {
        timedOutTaskIds.push(taskId);
        continue;
      }

      if (state.ok && state.output) {
        completed.push(state.output);
      } else {
        failedTaskIds.push(taskId);
      }
    }

    if (timedOutTaskIds.length > 0 && this.delegate.cancel) {
      await Promise.allSettled(timedOutTaskIds.map((taskId) => this.delegate.cancel?.(taskId)));
    }

    return {
      completed,
      timedOutTaskIds,
      failedTaskIds
    };
  }
}
