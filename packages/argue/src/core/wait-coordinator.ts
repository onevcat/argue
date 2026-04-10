import type { AgentTaskDelegate, WaitCoordinator } from "../contracts/delegate.js";
import type { ArgueStartInput } from "../contracts/request.js";
import { AgentTaskResultSchema } from "../contracts/task.js";
import type { ParticipantRoundOutput } from "../contracts/result.js";

type TaskState = {
  done: boolean;
  status?: "completed" | "failed" | "timeout";
  output?: ParticipantRoundOutput;
  error?: string;
  settledAt?: string;
};

export class DefaultWaitCoordinator implements WaitCoordinator {
  constructor(private readonly delegate: AgentTaskDelegate) {}

  async waitRound(args: {
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
  }> {
    const states = new Map<string, TaskState>();
    const hookErrors: unknown[] = [];

    for (const taskId of args.taskIds) {
      states.set(taskId, { done: false });
    }

    let finishedCount = 0;
    let resolveAllDone: (() => void) | undefined;
    const allDone = new Promise<void>((resolve) => {
      resolveAllDone = resolve;
    });

    const settleTask = async (taskId: string, state: Omit<TaskState, "done">): Promise<void> => {
      const current = states.get(taskId);
      if (!current || current.done) return;

      states.set(taskId, {
        done: true,
        ...state
      });

      if (!args.onTaskSettled || !state.status || !state.settledAt) {
        return;
      }

      try {
        await args.onTaskSettled({
          taskId,
          status: state.status,
          at: state.settledAt,
          output: state.output,
          error: state.error
        });
      } catch (error) {
        hookErrors.push(error);
      }
    };

    for (const taskId of args.taskIds) {
      void (async () => {
        try {
          const result = await this.delegate.awaitResult(taskId, args.policy.perTaskTimeoutMs);
          const settledAt = new Date().toISOString();

          if (!result.ok || !result.output) {
            const error = result.error ?? "unknown_error";
            const status = error === "__timeout__" ? "timeout" : "failed";
            await settleTask(taskId, { status, error, settledAt });
            return;
          }

          const parsed = AgentTaskResultSchema.safeParse(result.output);
          if (!parsed.success || parsed.data.kind !== "round") {
            await settleTask(taskId, {
              status: "failed",
              error: "invalid_round_result",
              settledAt
            });
            return;
          }

          await settleTask(taskId, {
            status: "completed",
            output: { ...parsed.data.output, respondedAt: settledAt },
            settledAt
          });
        } catch (error) {
          await settleTask(taskId, {
            status: "failed",
            error: String(error),
            settledAt: new Date().toISOString()
          });
        } finally {
          finishedCount += 1;
          if (finishedCount === args.taskIds.length) {
            resolveAllDone?.();
          }
        }
      })();
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("timeout"), args.policy.perRoundTimeoutMs);
      timeoutHandle.unref?.();
    });

    try {
      await Promise.race([allDone, timeoutPromise]);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }

    for (const taskId of args.taskIds) {
      const state = states.get(taskId);
      if (state?.done) continue;
      await settleTask(taskId, {
        status: "timeout",
        error: "__round_timeout__",
        settledAt: new Date().toISOString()
      });
    }

    const completed: ParticipantRoundOutput[] = [];
    const timedOutTaskIds: string[] = [];
    const failedTaskIds: string[] = [];

    for (const taskId of args.taskIds) {
      const state = states.get(taskId);
      if (!state || !state.done || !state.status) {
        timedOutTaskIds.push(taskId);
        continue;
      }

      if (state.status === "timeout") {
        timedOutTaskIds.push(taskId);
        continue;
      }

      if (state.status === "completed" && state.output) {
        completed.push(state.output);
      } else {
        failedTaskIds.push(taskId);
      }
    }

    if (timedOutTaskIds.length > 0 && this.delegate.cancel) {
      await Promise.allSettled(timedOutTaskIds.map((taskId) => this.delegate.cancel?.(taskId)));
    }

    if (hookErrors.length > 0) {
      throw hookErrors[0] instanceof Error ? hookErrors[0] : new Error(String(hookErrors[0]));
    }

    return {
      completed,
      timedOutTaskIds,
      failedTaskIds
    };
  }
}
