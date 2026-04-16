import type { AgentTaskDelegate, ArgueObserver, SessionStore, WaitCoordinator } from "../contracts/delegate.js";
import { normalizeStartInput, type ArgueStartInput, type NormalizedArgueStartInput } from "../contracts/request.js";
import {
  ARGUE_RESULT_VERSION,
  ARGUE_TASK_TITLE_MAX,
  ArgueResultSchema,
  type ActionOutput,
  type ArgueResult,
  type Claim,
  type ClaimResolution,
  type ClaimVote,
  type EliminationRecord,
  type FinalReport,
  type ParticipantRoundOutput,
  type ParticipantScore,
  type Phase,
  type RoundAppliedMerge,
  type RoundRecord,
  type Task
} from "../contracts/result.js";
import { buildBuiltinReport } from "./report-compose.js";
import { computeParticipantScores, chooseRepresentative } from "./scoring.js";
import { ArgueStateMachine } from "./state-machine.js";
import { DefaultWaitCoordinator } from "./wait-coordinator.js";
import { MemorySessionStore } from "../store/memory-store.js";
import {
  ActionTaskResultSchema,
  ReportTaskResultSchema,
  REPORT_OUTPUT_CONTENT_SCHEMA_REF,
  ReportOutputContentJsonSchema,
  RoundTaskInputSchema,
  getRoundOutputContentJsonSchema,
  getRoundOutputContentSchemaRef,
  type ActionTaskInput,
  type AgentTaskInput,
  type ReportTaskInput
} from "../contracts/task.js";

export interface ArgueEngineDeps {
  taskDelegate: AgentTaskDelegate;
  observer?: ArgueObserver;
  waitCoordinator?: WaitCoordinator;
  sessionStore?: SessionStore;
  now?: () => number;
  idFactory?: () => string;
}

export class ArgueEngine {
  private readonly waitCoordinator: WaitCoordinator;
  private readonly store: SessionStore;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly deps: ArgueEngineDeps) {
    this.waitCoordinator = deps.waitCoordinator ?? new DefaultWaitCoordinator(deps.taskDelegate);
    this.store = deps.sessionStore ?? new MemorySessionStore();
    this.now = deps.now ?? (() => Date.now());
    this.idFactory = deps.idFactory ?? (() => `argue_${globalThis.crypto.randomUUID()}`);
  }

  async start(input: ArgueStartInput): Promise<ArgueResult> {
    const startAt = this.now();
    const normalized = normalizeStartInput(input);
    const sessionId = this.idFactory();
    const state = new ArgueStateMachine();
    const allParticipants = normalized.participants.map((participant) => participant.id);

    const activeParticipants = new Set<string>(allParticipants);
    const participantSessionMap = new Map<string, string>(
      allParticipants.map((participantId) => [
        participantId,
        `${normalized.sessionPolicy.sessionKeyPrefix ?? "argue"}:${sessionId}:${participantId}`
      ])
    );

    const rounds: RoundRecord[] = [];
    let claimCatalog: Claim[] = [];
    const eliminations: EliminationRecord[] = [];

    const metrics = {
      retries: 0,
      waitTimeouts: 0,
      totalTurns: 0,
      earlyStopTriggered: false,
      globalDeadlineHit: false
    };

    await this.store.save({
      sessionId,
      requestId: normalized.requestId,
      participants: allParticipants,
      activeParticipants: [...activeParticipants],
      eliminations,
      state: state.current,
      startedAt: new Date(startAt).toISOString()
    });

    try {
      state.transition("running");
      await this.store.update(sessionId, {
        state: state.current,
        runningAt: new Date(this.now()).toISOString()
      });

      await this.emit(normalized, sessionId, "SessionStarted", {
        participants: allParticipants,
        minParticipants: normalized.participantsPolicy.minParticipants
      });

      const initialResult = await this.runRound({
        normalized,
        startAt,
        sessionId,
        participantSessionMap,
        activeParticipants,
        phase: "initial",
        round: 0,
        claimCatalog,
        previousOutputs: [],
        metrics,
        eliminations
      });

      rounds.push({ round: 0, outputs: initialResult.outputs, appliedMerges: initialResult.appliedMerges });
      claimCatalog = initialResult.claimCatalog;

      let interruptReason: string | null = null;
      if (!this.hasMinParticipants(normalized, activeParticipants.size)) {
        this.enforceMinParticipants(normalized, activeParticipants.size, "initial round");
        interruptReason = `Discussion interrupted after initial round: active=${activeParticipants.size}, required=${normalized.participantsPolicy.minParticipants}`;
      }

      let previousOutputs = initialResult.outputs;

      for (let round = 1; !interruptReason && round <= normalized.roundPolicy.maxRounds; round += 1) {
        if (this.isGlobalDeadlineHit(normalized, startAt)) {
          metrics.globalDeadlineHit = true;
          await this.emit(normalized, sessionId, "GlobalDeadlineHit", {
            round,
            globalDeadlineMs: normalized.waitingPolicy.globalDeadlineMs
          });
          break;
        }

        const debateResult = await this.runRound({
          normalized,
          startAt,
          sessionId,
          participantSessionMap,
          activeParticipants,
          phase: "debate",
          round,
          claimCatalog,
          previousOutputs,
          metrics,
          eliminations
        });

        rounds.push({ round, outputs: debateResult.outputs, appliedMerges: debateResult.appliedMerges });

        if (!this.hasMinParticipants(normalized, activeParticipants.size)) {
          this.enforceMinParticipants(normalized, activeParticipants.size, `debate round ${round}`);
          interruptReason = `Discussion interrupted after debate round ${round}: active=${activeParticipants.size}, required=${normalized.participantsPolicy.minParticipants}`;
          break;
        }
        claimCatalog = debateResult.claimCatalog;
        previousOutputs = debateResult.outputs;

        if (
          round >= normalized.roundPolicy.minRounds &&
          shouldEarlyStop(debateResult.outputs, debateResult.newClaimCount)
        ) {
          metrics.earlyStopTriggered = true;
          await this.emit(normalized, sessionId, "EarlyStopTriggered", {
            round,
            reason: "all_agree_no_new_claims"
          });
          break;
        }
      }

      // Final vote: run if we have active participants (even just one for interrupted sessions)
      const finalVoteRound = (rounds.at(-1)?.round ?? 0) + 1;
      let finalVoteOutputs: ParticipantRoundOutput[] = [];
      const skipFinalVote = metrics.globalDeadlineHit || activeParticipants.size === 0;
      if (!skipFinalVote) {
        if (this.isGlobalDeadlineHit(normalized, startAt)) {
          metrics.globalDeadlineHit = true;
          await this.emit(normalized, sessionId, "GlobalDeadlineHit", {
            round: finalVoteRound,
            globalDeadlineMs: normalized.waitingPolicy.globalDeadlineMs
          });
        } else {
          const finalVoteResult = await this.runRound({
            normalized,
            startAt,
            sessionId,
            participantSessionMap,
            activeParticipants,
            phase: "final_vote",
            round: finalVoteRound,
            claimCatalog,
            previousOutputs,
            metrics,
            eliminations
          });
          if (!this.hasMinParticipants(normalized, activeParticipants.size) && !interruptReason) {
            this.enforceMinParticipants(normalized, activeParticipants.size, "final vote");
            interruptReason = `Discussion interrupted after final vote: active=${activeParticipants.size}, required=${normalized.participantsPolicy.minParticipants}`;
          }
          finalVoteOutputs = finalVoteResult.outputs;
          rounds.push({
            round: finalVoteRound,
            outputs: finalVoteOutputs,
            appliedMerges: finalVoteResult.appliedMerges
          });
          claimCatalog = finalVoteResult.claimCatalog;
        }
      }

      const claimResolutions = buildClaimResolutions({
        claims: claimCatalog,
        finalVoteOutputs,
        threshold: normalized.consensusPolicy.threshold,
        forceUnresolved: metrics.globalDeadlineHit
      });

      await this.emit(normalized, sessionId, "ConsensusDrafted", {
        claimCount: claimCatalog.filter((claim) => claim.status === "active").length,
        resolvedCount: claimResolutions.filter((x) => x.status === "resolved").length
      });

      const scoreboard = computeParticipantScores({
        participants: allParticipants,
        rounds,
        finalClaims: claimCatalog,
        scoringPolicy: normalized.scoringPolicy
      });

      if (interruptReason) {
        await this.emit(normalized, sessionId, "SessionInterrupted", {
          reason: interruptReason,
          activeParticipants: [...activeParticipants],
          eliminations
        });
      }

      const activeScoreboard = scoreboard.filter((score) => activeParticipants.has(score.participantId));

      // For representative selection, fall back to full scoreboard if no active participants remain
      const candidateScoreboard = activeScoreboard.length > 0 ? activeScoreboard : scoreboard;

      const designated = normalized.reportPolicy.representativeId;
      const designatedIsActive = typeof designated === "string" && activeParticipants.has(designated);

      const selected = designatedIsActive
        ? {
            participantId: designated,
            score: candidateScoreboard.find((x) => x.participantId === designated)?.total ?? 0,
            reason: "host-designated" as const
          }
        : chooseRepresentative({
            scores: candidateScoreboard,
            rounds,
            tieBreaker: normalized.scoringPolicy.tieBreaker
          });

      const representativeSpeech = this.pickRepresentativeSpeech(selected.participantId, rounds);

      const status = interruptReason
        ? ("interrupted" as const)
        : aggregateSessionStatus({
            claimResolutions,
            globalDeadlineHit: metrics.globalDeadlineHit
          });

      const report = await this.composeReport({
        normalized,
        requestId: normalized.requestId,
        sessionId,
        status,
        representative: {
          participantId: selected.participantId,
          speech: representativeSpeech,
          score: selected.score
        },
        finalClaims: claimCatalog,
        claimResolutions,
        rounds,
        scoreboard,
        activeParticipants
      });

      state.transition("finalizing");
      await this.store.update(sessionId, {
        state: state.current,
        finalizingAt: new Date(this.now()).toISOString()
      });

      const task: Task = {
        prompt: normalized.task,
        title: selectTaskTitle({
          rounds,
          representativeId: selected.participantId,
          scoreboard,
          fallbackPrompt: normalized.task
        })
      };

      const result: ArgueResult = ArgueResultSchema.parse({
        resultVersion: ARGUE_RESULT_VERSION,
        requestId: normalized.requestId,
        sessionId,
        task,
        status,
        finalClaims: claimCatalog,
        claimResolutions,
        representative: {
          participantId: selected.participantId,
          reason: selected.reason,
          score: selected.score,
          speech: representativeSpeech
        },
        scoreboard,
        eliminations,
        report,
        disagreements: collectDisagreements(rounds),
        rounds,
        metrics: {
          elapsedMs: Math.max(0, this.now() - startAt),
          totalRounds: rounds.length,
          totalTurns: metrics.totalTurns,
          retries: metrics.retries,
          waitTimeouts: metrics.waitTimeouts,
          earlyStopTriggered: metrics.earlyStopTriggered,
          globalDeadlineHit: metrics.globalDeadlineHit
        },
        ...(interruptReason ? { error: { code: "INSUFFICIENT_PARTICIPANTS", message: interruptReason } } : {})
      });

      const actionOutput = await this.executeAction({
        normalized,
        requestId: normalized.requestId,
        sessionId,
        result,
        activeParticipants
      });
      if (actionOutput) {
        result.action = actionOutput;
      }

      state.transition("finished");
      await this.store.update(sessionId, {
        state: state.current,
        result,
        activeParticipants: [...activeParticipants],
        eliminations,
        finishedAt: new Date(this.now()).toISOString()
      });

      await this.emit(normalized, sessionId, "Finalized", {
        status,
        representative: selected.participantId
      });

      return result;
    } catch (error) {
      await this.handleFailure({
        error,
        normalized,
        sessionId,
        state,
        activeParticipants,
        eliminations
      });
      throw error;
    }
  }

  private async runRound(args: {
    normalized: NormalizedArgueStartInput;
    startAt: number;
    sessionId: string;
    participantSessionMap: Map<string, string>;
    activeParticipants: Set<string>;
    phase: Phase;
    round: number;
    claimCatalog: Claim[];
    previousOutputs: ParticipantRoundOutput[];
    metrics: {
      retries: number;
      waitTimeouts: number;
      totalTurns: number;
      earlyStopTriggered: boolean;
      globalDeadlineHit: boolean;
    };
    eliminations: EliminationRecord[];
  }): Promise<{
    outputs: ParticipantRoundOutput[];
    claimCatalog: Claim[];
    newClaimCount: number;
    appliedMerges: RoundAppliedMerge[];
  }> {
    const participantIds = [...args.activeParticipants];
    const dispatches = await Promise.all(
      participantIds.map(async (participantId) => {
        const participant = args.normalized.participants.find((item) => item.id === participantId);
        if (!participant) {
          throw new Error(`Missing participant configuration for ${participantId}`);
        }

        const peerRoundInputs = args.previousOutputs
          .filter((output) => output.participantId !== participantId)
          .slice(0, args.normalized.peerContextPolicy.maxPeersPerRound)
          .map((output) => {
            const { text, truncated } = applyTextBudget(
              output.fullResponse,
              args.normalized.peerContextPolicy.maxCharsPerPeerResponse,
              args.normalized.peerContextPolicy.overflowStrategy
            );
            return {
              participantId: output.participantId,
              round: output.round,
              fullResponse: text,
              truncated
            };
          });

        const visibleClaimCatalog =
          args.phase === "initial"
            ? args.claimCatalog
            : args.claimCatalog.filter((claim) => claim.status === "active" || claim.status === undefined);

        const task = RoundTaskInputSchema.parse({
          kind: "round",
          sessionId: args.sessionId,
          requestId: args.normalized.requestId,
          participantId,
          phase: args.phase,
          round: args.round,
          prompt: this.buildRoundPrompt(args.normalized, args.phase, args.round),
          selfHistoryRef: { stickySession: true },
          peerRoundInputs,
          claimCatalog: visibleClaimCatalog,
          metadata: {
            participantSessionKey: args.participantSessionMap.get(participantId),
            role: participant.role,
            peerContextPassMode: args.normalized.peerContextPolicy.passMode,
            constraints: args.normalized.constraints,
            context: args.normalized.context,
            outputSchema: {
              ref: getRoundOutputContentSchemaRef(args.phase),
              jsonSchema: getRoundOutputContentJsonSchema(args.phase)
            }
          }
        });

        const dispatched = await this.deps.taskDelegate.dispatch(task);
        return {
          taskId: dispatched.taskId,
          participantId
        };
      })
    );

    const taskIds = dispatches.map((dispatch) => dispatch.taskId);
    const taskParticipantMap = new Map(dispatches.map((item) => [item.taskId, item.participantId]));

    await this.emit(args.normalized, args.sessionId, "RoundDispatched", {
      phase: args.phase,
      round: args.round,
      participants: participantIds,
      taskIds
    });

    const waited = await this.waitCoordinator.waitRound({
      round: args.round,
      taskIds,
      policy: this.resolveRoundWaitingPolicy(args.normalized, args.startAt),
      onTaskSettled: async (event) => {
        const participantId = taskParticipantMap.get(event.taskId);
        if (!participantId) return;

        if (event.status === "completed") {
          args.metrics.totalTurns += 1;
          await this.emit(
            args.normalized,
            args.sessionId,
            "ParticipantResponded",
            {
              phase: args.phase,
              round: args.round,
              participantId,
              summary: event.output?.summary,
              extractedClaims: event.output?.extractedClaims?.length ?? 0,
              judgements: event.output?.judgements.length ?? 0,
              stanceAgree: event.output?.judgements.filter((j) => j.stance === "agree").length ?? 0,
              stanceDisagree: event.output?.judgements.filter((j) => j.stance === "disagree").length ?? 0,
              stanceRevise: event.output?.judgements.filter((j) => j.stance === "revise").length ?? 0,
              claimVotes: event.output?.phase === "final_vote" ? event.output.claimVotes.length : 0,
              fullResponse: event.output?.fullResponse,
              extractedClaimsDetail: event.output?.extractedClaims,
              judgementsDetail: event.output?.judgements,
              claimVotesDetail: event.output?.phase === "final_vote" ? event.output.claimVotes : undefined
            },
            event.at
          );
          return;
        }

        const reason = event.status === "timeout" ? "timeout" : "error";
        if (reason === "timeout") {
          args.metrics.waitTimeouts += 1;
        }

        const wasActive = args.activeParticipants.has(participantId);
        this.eliminateParticipant({
          participantId,
          round: args.round,
          reason,
          activeParticipants: args.activeParticipants,
          eliminations: args.eliminations
        });

        if (!wasActive) return;

        await this.emit(
          args.normalized,
          args.sessionId,
          "ParticipantEliminated",
          {
            phase: args.phase,
            round: args.round,
            participantId,
            reason,
            error: event.error
          },
          event.at
        );
      }
    });

    const outputs = waited.completed
      .filter((output) => output.phase === args.phase && output.round === args.round)
      .filter((output) => args.activeParticipants.has(output.participantId));

    const { claims, newClaimCount, mergeEvents } =
      args.phase === "final_vote"
        ? { claims: [...args.claimCatalog], newClaimCount: 0, mergeEvents: [] as RoundAppliedMerge[] }
        : updateClaims(args.claimCatalog, outputs);

    for (const merge of mergeEvents) {
      await this.emit(args.normalized, args.sessionId, "ClaimsMerged", {
        phase: args.phase,
        round: args.round,
        sourceClaimId: merge.sourceClaimId,
        mergedInto: merge.targetClaimId
      });
    }

    await this.emit(args.normalized, args.sessionId, "RoundCompleted", {
      phase: args.phase,
      round: args.round,
      completed: outputs.length,
      timedOut: waited.timedOutTaskIds.length,
      failed: waited.failedTaskIds.length,
      activeParticipants: [...args.activeParticipants],
      claimCatalogSize: claims.length,
      newClaims: newClaimCount,
      mergeCount: mergeEvents.length
    });

    await this.store.update(args.sessionId, {
      activeParticipants: [...args.activeParticipants],
      eliminations: args.eliminations
    });

    return {
      outputs,
      claimCatalog: claims,
      newClaimCount,
      appliedMerges: mergeEvents
    };
  }

  private async composeReport(args: {
    normalized: NormalizedArgueStartInput;
    requestId: string;
    sessionId: string;
    status: ArgueResult["status"];
    representative: { participantId: string; speech: string; score: number };
    finalClaims: Claim[];
    claimResolutions: ClaimResolution[];
    rounds: RoundRecord[];
    scoreboard: ParticipantScore[];
    activeParticipants: Set<string>;
  }): Promise<FinalReport> {
    const fallback = (): FinalReport =>
      buildBuiltinReport({
        includeDeliberationTrace: args.normalized.reportPolicy.includeDeliberationTrace,
        traceLevel: args.normalized.reportPolicy.traceLevel,
        status: args.status,
        representativeSpeech: args.representative.speech,
        rounds: args.rounds,
        representativeId: args.representative.participantId,
        finalClaims: args.finalClaims,
        claimResolutions: args.claimResolutions
      });

    if (args.normalized.reportPolicy.composer !== "representative") {
      return fallback();
    }

    const reporterId = args.normalized.reportPolicy.representativeId ?? args.representative.participantId;
    const reportSessionId = `${args.normalized.sessionPolicy.sessionKeyPrefix ?? "argue"}:${args.sessionId}:report:${reporterId}`;

    const task: ReportTaskInput = {
      kind: "report",
      sessionId: reportSessionId,
      requestId: args.requestId,
      participantId: reporterId,
      prompt: this.buildReportPrompt(args.normalized),
      reportInput: {
        status: args.status,
        representative: args.representative,
        finalClaims: args.finalClaims,
        claimResolutions: args.claimResolutions,
        scoreboard: args.scoreboard,
        rounds: args.rounds
      },
      metadata: {
        separateSession: true,
        reporterIsActiveParticipant: args.activeParticipants.has(reporterId),
        requestedRepresentativeId: args.normalized.reportPolicy.representativeId,
        constraints: args.normalized.constraints,
        context: args.normalized.context,
        outputSchema: {
          ref: REPORT_OUTPUT_CONTENT_SCHEMA_REF,
          jsonSchema: ReportOutputContentJsonSchema
        }
      }
    };

    await this.emit(args.normalized, args.sessionId, "ReportDispatched", {
      reporterId,
      composer: "representative"
    });

    let dispatched: Awaited<ReturnType<AgentTaskDelegate["dispatch"]>>;
    try {
      dispatched = await this.deps.taskDelegate.dispatch(task as AgentTaskInput);
    } catch {
      await this.emit(args.normalized, args.sessionId, "ReportCompleted", {
        reporterId,
        mode: "builtin",
        reason: "dispatch_failed"
      });
      return fallback();
    }

    let awaited: Awaited<ReturnType<AgentTaskDelegate["awaitResult"]>>;
    try {
      awaited = await this.deps.taskDelegate.awaitResult(
        dispatched.taskId,
        args.normalized.waitingPolicy.perTaskTimeoutMs
      );
    } catch {
      await this.emit(args.normalized, args.sessionId, "ReportCompleted", {
        reporterId,
        mode: "builtin",
        reason: "await_failed"
      });
      return fallback();
    }

    if (!awaited.ok || !awaited.output) {
      await this.emit(args.normalized, args.sessionId, "ReportCompleted", {
        reporterId,
        mode: "builtin",
        reason: "task_failed"
      });
      return fallback();
    }

    const parsed = ReportTaskResultSchema.safeParse(awaited.output);
    if (!parsed.success) {
      await this.emit(args.normalized, args.sessionId, "ReportCompleted", {
        reporterId,
        mode: "builtin",
        reason: "parse_failed"
      });
      return fallback();
    }

    await this.emit(args.normalized, args.sessionId, "ReportCompleted", {
      reporterId,
      mode: "representative"
    });

    return {
      ...parsed.data.output,
      mode: "representative"
    };
  }

  private async executeAction(args: {
    normalized: NormalizedArgueStartInput;
    requestId: string;
    sessionId: string;
    result: ArgueResult;
    activeParticipants: Set<string>;
  }): Promise<ActionOutput | undefined> {
    const actionPolicy = args.normalized.actionPolicy;
    if (!actionPolicy?.prompt) {
      return undefined;
    }

    const actorId = actionPolicy.actorId ?? args.result.representative.participantId;
    if (!args.activeParticipants.has(actorId)) {
      await this.emit(args.normalized, args.sessionId, "ActionFailed", {
        actorId,
        reason: "inactive_actor"
      });
      return {
        actorId,
        status: "failed",
        error: `Actor ${actorId} is not an active participant`
      };
    }

    const prefix = args.normalized.sessionPolicy.sessionKeyPrefix ?? "argue";
    const actionSessionId = `${prefix}:${args.sessionId}:action:${actorId}`;

    const task: ActionTaskInput = {
      kind: "action",
      sessionId: actionSessionId,
      requestId: args.requestId,
      participantId: actorId,
      prompt: actionPolicy.prompt,
      argueResult: {
        status: args.result.status,
        finalSummary: args.result.report.finalSummary,
        representativeSpeech: args.result.report.representativeSpeech,
        claims: args.result.finalClaims,
        claimResolutions: args.result.claimResolutions,
        scoreboard: args.result.scoreboard,
        disagreements: args.result.disagreements
      },
      fullResult: actionPolicy.includeFullResult ? JSON.parse(JSON.stringify(args.result)) : undefined
    };

    await this.emit(args.normalized, args.sessionId, "ActionDispatched", {
      actorId,
      prompt: actionPolicy.prompt
    });

    let dispatched: Awaited<ReturnType<AgentTaskDelegate["dispatch"]>>;
    try {
      dispatched = await this.deps.taskDelegate.dispatch(task as AgentTaskInput);
    } catch (caught) {
      await this.emit(args.normalized, args.sessionId, "ActionFailed", {
        actorId,
        reason: "dispatch_failed"
      });
      return { actorId, status: "failed", error: caught instanceof Error ? caught.message : String(caught) };
    }

    let awaited: Awaited<ReturnType<AgentTaskDelegate["awaitResult"]>>;
    try {
      awaited = await this.deps.taskDelegate.awaitResult(
        dispatched.taskId,
        args.normalized.waitingPolicy.perTaskTimeoutMs
      );
    } catch (caught) {
      await this.emit(args.normalized, args.sessionId, "ActionFailed", {
        actorId,
        reason: "await_failed"
      });
      return { actorId, status: "failed", error: caught instanceof Error ? caught.message : String(caught) };
    }

    if (!awaited.ok || !awaited.output) {
      await this.emit(args.normalized, args.sessionId, "ActionFailed", {
        actorId,
        reason: "task_failed"
      });
      return { actorId, status: "failed", error: awaited.error ?? "Action task failed" };
    }

    const parsed = ActionTaskResultSchema.safeParse(awaited.output);
    if (!parsed.success) {
      await this.emit(args.normalized, args.sessionId, "ActionFailed", {
        actorId,
        reason: "parse_failed"
      });
      return { actorId, status: "failed", error: "Action result parse failed" };
    }

    await this.emit(args.normalized, args.sessionId, "ActionCompleted", {
      actorId,
      summary: parsed.data.output.summary
    });

    return {
      actorId,
      status: "completed",
      fullResponse: parsed.data.output.fullResponse,
      summary: parsed.data.output.summary
    };
  }

  private resolveRoundWaitingPolicy(
    normalized: NormalizedArgueStartInput,
    startAt: number
  ): NonNullable<ArgueStartInput["waitingPolicy"]> {
    const policy = normalized.waitingPolicy;
    const deadline = policy.globalDeadlineMs;
    if (typeof deadline !== "number") {
      return policy;
    }

    const elapsed = this.now() - startAt;
    const remaining = Math.max(1, deadline - elapsed);
    return {
      ...policy,
      perRoundTimeoutMs: Math.min(policy.perRoundTimeoutMs, remaining)
    };
  }

  private eliminateParticipant(args: {
    participantId: string;
    round: number;
    reason: "timeout" | "error";
    activeParticipants: Set<string>;
    eliminations: EliminationRecord[];
  }): void {
    if (!args.activeParticipants.has(args.participantId)) {
      return;
    }

    args.activeParticipants.delete(args.participantId);
    args.eliminations.push({
      participantId: args.participantId,
      round: args.round,
      reason: args.reason,
      at: new Date(this.now()).toISOString()
    });
  }

  private pickRepresentativeSpeech(
    participantId: string,
    rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>
  ): string {
    const outputs = rounds
      .flatMap((round) => round.outputs)
      .filter((output) => output.participantId === participantId)
      .sort((a, b) => a.round - b.round);

    const latest = outputs.at(-1);
    if (!latest) {
      return `${participantId} has no available output.`;
    }

    return latest.fullResponse;
  }

  private isGlobalDeadlineHit(normalized: NormalizedArgueStartInput, startAt: number): boolean {
    const deadline = normalized.waitingPolicy.globalDeadlineMs;
    if (typeof deadline !== "number") return false;
    return this.now() - startAt >= deadline;
  }

  private hasMinParticipants(normalized: NormalizedArgueStartInput, count: number): boolean {
    return count >= normalized.participantsPolicy.minParticipants;
  }

  private enforceMinParticipants(normalized: NormalizedArgueStartInput, count: number, phase: string): void {
    if (normalized.participantsPolicy.onInsufficientParticipants === "fail") {
      throw new Error(
        `Round failed minimum participant requirement after ${phase}: completed=${count}, required=${normalized.participantsPolicy.minParticipants}`
      );
    }
  }

  private buildRoundPrompt(input: NormalizedArgueStartInput, phase: Phase, round: number): string {
    if (phase === "debate" && input.promptPolicy?.debateTemplate) {
      return input.promptPolicy.debateTemplate;
    }

    const shared = [
      "You are a participant in a structured multi-agent argument session.",
      "Return ONE valid JSON object only. Do not wrap with markdown/code fences.",
      `phase=${phase}`,
      `round=${round}`,
      `task=${input.task}`
    ];

    if (input.constraints?.language) {
      shared.push(`language=${input.constraints.language}`);
    }

    if (typeof input.constraints?.tokenBudgetHint === "number") {
      shared.push(`token_budget_hint=${input.constraints.tokenBudgetHint}`);
    }

    if (phase === "initial") {
      return [
        ...shared,
        "",
        "Phase goal:",
        "- Produce your independent initial analysis.",
        "- Propose concrete claims for later debate.",
        "",
        "Schema requirements (initial):",
        "- fullResponse: string",
        "- summary: string",
        "- taskTitle: concise one-sentence headline of the debate task. Aim for ~30 characters in CJK scripts (Chinese/Japanese/Korean) or ~60 characters in Latin scripts; hard cap 60. Single line, no markdown, no surrounding quotes.",
        "- extractedClaims: array of { title, statement, category? } — do NOT include claimId; the engine assigns IDs",
        "- judgements: array of { claimId, stance, confidence, rationale, revisedStatement?, mergesWith? }",
        "- claimVotes MUST NOT appear in initial phase",
        "",
        "Initial phase JSON template:",
        '{"fullResponse":"...","summary":"...","taskTitle":"...","extractedClaims":[{"title":"...","statement":"...","category":"pro"}],"judgements":[]}'
      ].join("\n");
    }

    if (phase === "debate") {
      return [
        ...shared,
        "",
        "Phase goal:",
        "- Critique and refine existing ACTIVE claims from claimCatalog and peerRoundInputs.",
        "- claimCatalog excludes already merged claims; treat any merged claims from prior context as historical and do not judge or merge them again.",
        "- Use mergesWith when two claims are duplicates; earliest claim should survive.",
        "- Add extractedClaims only for genuinely new points.",
        "",
        "Schema requirements (debate):",
        "- fullResponse: string",
        "- summary: string",
        "- judgements: NON-EMPTY array of { claimId, stance, confidence, rationale, revisedStatement?, mergesWith? }",
        "- extractedClaims: optional array of new claims { title, statement, category? } — do NOT include claimId",
        "- claimVotes MUST NOT appear in debate phase",
        "",
        "Debate phase JSON template:",
        '{"fullResponse":"...","summary":"...","judgements":[{"claimId":"c1","stance":"revise","confidence":0.82,"rationale":"...","revisedStatement":"...","mergesWith":"c0"}],"extractedClaims":[]}'
      ].join("\n");
    }

    return [
      ...shared,
      "",
      "Phase goal:",
      "- Vote each active claim independently.",
      "- claimCatalog contains active claims only; do not re-open or re-merge historical merged claims from prior context.",
      "- Every active claim should appear exactly once in claimVotes.",
      "",
      "Schema requirements (final_vote):",
      "- fullResponse: string",
      "- summary: string",
      "- judgements: array of { claimId, stance, confidence, rationale, revisedStatement?, mergesWith? } for traceability",
      "- claimVotes: NON-EMPTY array of { claimId, vote: accept|reject, reason? }",
      "",
      "Final vote JSON template:",
      '{"fullResponse":"...","summary":"...","judgements":[{"claimId":"c1","stance":"agree","confidence":0.9,"rationale":"..."}],"claimVotes":[{"claimId":"c1","vote":"accept","reason":"..."}]}'
    ].join("\n");
  }

  private buildReportPrompt(input: NormalizedArgueStartInput): string {
    if (input.promptPolicy?.reportTemplate) {
      return input.promptPolicy.reportTemplate;
    }

    const lines = [
      "You are the report composer for argue.",
      "Return ONE valid JSON object only. Do not wrap with markdown/code fences.",
      "Generate FinalReport with required fields:",
      "",
      "- finalSummary: the HEADLINE verdict — 2-4 punchy sentences that capture the core outcome",
      "  of the entire debate. No claim lists, no vote tallies, no per-participant breakdowns.",
      "  Think newspaper headline + one-paragraph lede: what was decided, and why it matters.",
      "- representativeSpeech: the DETAILED spokesperson statement — elaborate here with full",
      "  reasoning, key arguments, vote outcomes, notable disagreements, and nuance.",
      "  This is where depth belongs.",
      "- mode: representative",
      "- traceIncluded / traceLevel consistent with requested policy",
      "- optional opinionShiftTimeline and roundHighlights",
      `trace=${input.reportPolicy.includeDeliberationTrace ? "on" : "off"}`,
      `traceLevel=${input.reportPolicy.traceLevel}`,
      "",
      "FinalReport JSON template:",
      '{"mode":"representative","traceIncluded":false,"traceLevel":"compact","finalSummary":"...","representativeSpeech":"..."}'
    ];

    if (input.constraints?.language) {
      lines.push(`language=${input.constraints.language}`);
    }

    return lines.join("\n");
  }

  private async handleFailure(args: {
    error: unknown;
    normalized: NormalizedArgueStartInput;
    sessionId: string;
    state: ArgueStateMachine;
    activeParticipants: Set<string>;
    eliminations: EliminationRecord[];
  }): Promise<void> {
    if (args.state.current === "finished" || args.state.current === "failed") {
      return;
    }

    args.state.transition("failed");
    const failure = toFailureInfo(args.error);

    await Promise.allSettled([
      this.store.update(args.sessionId, {
        state: args.state.current,
        activeParticipants: [...args.activeParticipants],
        eliminations: args.eliminations,
        error: failure,
        failedAt: new Date(this.now()).toISOString()
      }),
      this.emit(args.normalized, args.sessionId, "Failed", failure)
    ]);
  }

  private async emit(
    normalized: NormalizedArgueStartInput,
    sessionId: string,
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
      | "ReportDispatched"
      | "ReportCompleted"
      | "ActionDispatched"
      | "ActionCompleted"
      | "ActionFailed"
      | "SessionInterrupted"
      | "Finalized"
      | "Failed",
    payload?: Record<string, unknown>,
    at?: string
  ): Promise<void> {
    if (!this.deps.observer) return;

    await this.deps.observer.onEvent({
      sessionId,
      requestId: normalized.requestId,
      type,
      at: at ?? new Date(this.now()).toISOString(),
      payload
    });
  }
}

/**
 * Pick the title that will represent the debate task in the final
 * result. Strategy:
 *
 *   1. Take the representative participant's own initial round
 *      taskTitle — the representative already carries the debate's
 *      voice in the report, and reusing their headline keeps the UI
 *      internally consistent.
 *   2. Otherwise walk the scoreboard (already sorted highest-first)
 *      and return the first participant whose initial output carries
 *      a taskTitle. This handles edge cases where the representative
 *      is host-designated but skipped the initial round.
 *   3. If no initial output surfaces a title at all (only possible
 *      in catastrophic failure paths), fall back to a truncation of
 *      the original task prompt so the schema's required title
 *      constraint is always satisfied.
 */
function selectTaskTitle(args: {
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>;
  representativeId: string;
  scoreboard: ParticipantScore[];
  fallbackPrompt: string;
}): string {
  const initRound = args.rounds.find((r) => r.round === 0);

  if (initRound) {
    const ownTitle = findInitialTaskTitle(initRound.outputs, args.representativeId);
    if (ownTitle) return ownTitle;

    for (const score of args.scoreboard) {
      if (score.participantId === args.representativeId) continue;
      const candidate = findInitialTaskTitle(initRound.outputs, score.participantId);
      if (candidate) return candidate;
    }
  }

  const trimmed = args.fallbackPrompt.trim();
  if (trimmed.length === 0) {
    return "Untitled argue session";
  }
  if (trimmed.length <= ARGUE_TASK_TITLE_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, ARGUE_TASK_TITLE_MAX - 1)}…`;
}

function findInitialTaskTitle(outputs: ParticipantRoundOutput[], participantId: string): string | undefined {
  for (const output of outputs) {
    if (output.phase !== "initial") continue;
    if (output.participantId !== participantId) continue;
    const candidate = (output as ParticipantRoundOutput & { taskTitle?: unknown }).taskTitle;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function shouldEarlyStop(outputs: ParticipantRoundOutput[], newClaimCount: number): boolean {
  if (outputs.length === 0) return false;
  if (newClaimCount > 0) return false;

  for (const output of outputs) {
    if (output.judgements.length === 0) return false;
    for (const judgement of output.judgements) {
      if (judgement.stance !== "agree") return false;
      if (typeof judgement.revisedStatement === "string") return false;
    }
  }

  return true;
}

function updateClaims(
  base: Claim[],
  outputs: ParticipantRoundOutput[]
): { claims: Claim[]; newClaimCount: number; mergeEvents: RoundAppliedMerge[] } {
  const claimMap = new Map<string, Claim>(
    base.map((claim) => [claim.claimId, { ...claim, proposedBy: [...claim.proposedBy] }])
  );
  const order = new Map<string, number>([...claimMap.keys()].map((id, idx) => [id, idx]));
  let nextOrder = order.size;
  let newClaimCount = 0;
  const seqByParticipant = new Map<string, number>();

  for (const output of outputs) {
    for (const extracted of output.extractedClaims ?? []) {
      const seq = seqByParticipant.get(output.participantId) ?? 0;
      seqByParticipant.set(output.participantId, seq + 1);
      const claimId = `${output.participantId}:${output.round}:${seq}`;
      claimMap.set(claimId, {
        claimId,
        title: extracted.title,
        statement: extracted.statement,
        category: extracted.category,
        proposedBy: [output.participantId],
        status: "active"
      });
      order.set(claimId, nextOrder++);
      newClaimCount += 1;
    }
  }

  if (claimMap.size === 0) {
    for (const output of outputs) {
      const claimId = `seed:${output.participantId}:${output.round}`;
      claimMap.set(claimId, {
        claimId,
        title: `Seed from ${output.participantId}`,
        statement: output.summary,
        category: "todo",
        proposedBy: [output.participantId],
        status: "active"
      });
      order.set(claimId, nextOrder++);
      newClaimCount += 1;
    }
  }

  const mergeEventsBySource = new Map<
    string,
    {
      sourceClaimId: string;
      targetClaimId: string;
      participantIds: Set<string>;
    }
  >();

  const appendMergeParticipant = (
    sourceClaimId: string,
    targetClaimId: string,
    participantId: string,
    options?: { createIfMissing?: boolean }
  ) => {
    const existing = mergeEventsBySource.get(sourceClaimId);
    if (existing && existing.targetClaimId === targetClaimId) {
      existing.participantIds.add(participantId);
      return;
    }
    if (!existing && options?.createIfMissing) {
      mergeEventsBySource.set(sourceClaimId, {
        sourceClaimId,
        targetClaimId,
        participantIds: new Set([participantId])
      });
    }
  };

  for (const output of outputs) {
    for (const judgement of output.judgements) {
      const directClaim = claimMap.get(judgement.claimId);
      const targetId = resolveClaimId(claimMap, judgement.claimId);
      if (!directClaim && !claimMap.get(targetId)) continue;

      if (judgement.revisedStatement && (judgement.stance === "revise" || judgement.stance === "disagree")) {
        const revisionTarget = directClaim ?? claimMap.get(targetId);
        if (revisionTarget) {
          revisionTarget.statement = judgement.revisedStatement;
        }
      }

      if (!judgement.mergesWith) continue;

      const mergeIntoId = resolveClaimId(claimMap, judgement.mergesWith);
      if (!claimMap.has(mergeIntoId)) continue;

      if (targetId === mergeIntoId) {
        if (directClaim?.status === "merged" && directClaim.mergedInto === mergeIntoId) {
          appendMergeParticipant(directClaim.claimId, mergeIntoId, output.participantId);
        }
        continue;
      }

      const leftOrder = order.get(targetId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(mergeIntoId) ?? Number.MAX_SAFE_INTEGER;
      const survivorId = leftOrder <= rightOrder ? targetId : mergeIntoId;
      const loserId = survivorId === targetId ? mergeIntoId : targetId;

      const survivor = claimMap.get(survivorId);
      const loser = claimMap.get(loserId);
      if (!survivor || !loser) continue;

      loser.status = "merged";
      loser.mergedInto = survivorId;
      survivor.proposedBy = [...new Set([...survivor.proposedBy, ...loser.proposedBy])];

      for (const [id, entry] of claimMap.entries()) {
        if (entry.status === "merged" && entry.mergedInto === loserId) {
          entry.mergedInto = survivorId;
          claimMap.set(id, entry);
        }
      }

      appendMergeParticipant(loserId, survivorId, output.participantId, { createIfMissing: true });
    }
  }

  const mergeEvents: RoundAppliedMerge[] = [...mergeEventsBySource.values()]
    .sort((a, b) => {
      const leftOrder = order.get(a.sourceClaimId) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = order.get(b.sourceClaimId) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || a.sourceClaimId.localeCompare(b.sourceClaimId);
    })
    .map((merge) => ({
      sourceClaimId: merge.sourceClaimId,
      targetClaimId: merge.targetClaimId,
      participantIds: [...merge.participantIds].sort((a, b) => a.localeCompare(b))
    }));

  return {
    claims: [...claimMap.values()],
    newClaimCount,
    mergeEvents
  };
}

function resolveClaimId(claimMap: Map<string, Claim>, claimId: string): string {
  let current = claimId;
  const seen = new Set<string>();

  while (!seen.has(current)) {
    seen.add(current);
    const claim = claimMap.get(current);
    if (!claim || claim.status !== "merged" || !claim.mergedInto) {
      return current;
    }
    current = claim.mergedInto;
  }

  return current;
}

function buildClaimResolutions(args: {
  claims: Claim[];
  finalVoteOutputs: ParticipantRoundOutput[];
  threshold: number;
  forceUnresolved: boolean;
}): ClaimResolution[] {
  const activeClaims = args.claims.filter((claim) => claim.status === "active");
  const activeClaimIds = new Set(activeClaims.map((claim) => claim.claimId));

  const votesByClaim = new Map<string, Map<string, ClaimVote>>();
  for (const claim of activeClaims) {
    votesByClaim.set(claim.claimId, new Map());
  }

  for (const output of args.finalVoteOutputs) {
    if (output.phase !== "final_vote") continue;

    for (const vote of output.claimVotes ?? []) {
      if (!activeClaimIds.has(vote.claimId)) continue;
      const normalized: ClaimVote = {
        participantId: output.participantId,
        claimId: vote.claimId,
        vote: vote.vote,
        reason: vote.reason
      };
      votesByClaim.get(vote.claimId)?.set(output.participantId, normalized);
    }
  }

  return activeClaims.map((claim) => {
    const votes = [...(votesByClaim.get(claim.claimId)?.values() ?? [])];
    const acceptCount = votes.filter((vote) => vote.vote === "accept").length;
    const rejectCount = votes.filter((vote) => vote.vote === "reject").length;
    const totalVoters = votes.length;

    const ratio = totalVoters > 0 ? acceptCount / totalVoters : 0;
    const resolved = !args.forceUnresolved && totalVoters > 0 && ratio >= args.threshold;

    return {
      claimId: claim.claimId,
      status: resolved ? "resolved" : "unresolved",
      acceptCount,
      rejectCount,
      totalVoters,
      votes
    };
  });
}

function aggregateSessionStatus(args: {
  claimResolutions: ClaimResolution[];
  globalDeadlineHit: boolean;
}): ArgueResult["status"] {
  if (args.globalDeadlineHit) {
    return "unresolved";
  }

  if (args.claimResolutions.length === 0) {
    return "unresolved";
  }

  const resolvedCount = args.claimResolutions.filter((item) => item.status === "resolved").length;
  if (resolvedCount === args.claimResolutions.length) {
    return "consensus";
  }

  if (resolvedCount > 0) {
    return "partial_consensus";
  }

  return "unresolved";
}

function applyTextBudget(
  text: string,
  maxChars: number,
  strategy: "truncate-tail" | "truncate-middle"
): { text: string; truncated?: boolean } {
  if (text.length <= maxChars) return { text };
  if (maxChars < 10) return { text: text.slice(0, maxChars), truncated: true };

  if (strategy === "truncate-middle") {
    const head = Math.floor((maxChars - 1) / 2);
    const tail = maxChars - 1 - head;
    return {
      text: `${text.slice(0, head)}…${text.slice(text.length - tail)}`,
      truncated: true
    };
  }

  return {
    text: `${text.slice(0, maxChars - 1)}…`,
    truncated: true
  };
}

function collectDisagreements(
  rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>
): Array<{ claimId: string; participantId: string; reason: string }> {
  const out: Array<{ claimId: string; participantId: string; reason: string }> = [];
  for (const round of rounds) {
    for (const output of round.outputs) {
      for (const judgement of output.judgements) {
        if (judgement.stance !== "disagree") continue;
        out.push({
          claimId: judgement.claimId,
          participantId: output.participantId,
          reason: judgement.rationale
        });
      }
    }
  }
  return out;
}

function toFailureInfo(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return {
      code: error.name || "Error",
      message: error.message
    };
  }

  return {
    code: "UnknownError",
    message: String(error)
  };
}
