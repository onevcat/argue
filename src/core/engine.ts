import { randomUUID } from "node:crypto";
import type {
  AgentTaskDelegate,
  ArgueObserver,
  ReportComposerDelegate,
  SessionStore,
  WaitCoordinator
} from "../contracts/delegate.js";
import {
  normalizeStartInput,
  type ArgueStartInput,
  type NormalizedArgueStartInput
} from "../contracts/request.js";
import {
  ArgueResultSchema,
  type ArgueResult,
  type Claim,
  type ParticipantRoundOutput,
  type ParticipantScore,
  type Phase
} from "../contracts/result.js";
import { RoundTaskInputSchema } from "../contracts/task.js";
import { buildBuiltinReport } from "./report-compose.js";
import { computeParticipantScores, chooseRepresentative } from "./scoring.js";
import { ArgueStateMachine } from "./state-machine.js";
import { DefaultWaitCoordinator } from "./wait-coordinator.js";
import { MemorySessionStore } from "../store/memory-store.js";

export interface ArgueEngineDeps {
  taskDelegate: AgentTaskDelegate;
  observer?: ArgueObserver;
  reportComposer?: ReportComposerDelegate;
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
    this.idFactory = deps.idFactory ?? (() => `argue_${randomUUID()}`);
  }

  async start(input: ArgueStartInput): Promise<ArgueResult> {
    const startAt = this.now();
    const normalized = normalizeStartInput(input);
    const sessionId = this.idFactory();
    const state = new ArgueStateMachine();
    const participants = normalized.participants.map((participant) => participant.id);

    const participantSessionMap = new Map<string, string>(
      participants.map((participantId) => [
        participantId,
        `${normalized.sessionPolicy.sessionKeyPrefix ?? "argue"}:${sessionId}:${participantId}`
      ])
    );

    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [];
    let claimCatalog: Claim[] = [];
    const metrics = {
      retries: 0,
      waitTimeouts: 0,
      totalTurns: 0
    };

    await this.store.save({
      sessionId,
      requestId: normalized.requestId,
      participants,
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
        participants,
        minParticipants: normalized.participantsPolicy.minParticipants
      });

      const initialOutputs = await this.runRound({
        normalized,
        sessionId,
        participantSessionMap,
        phase: "initial",
        round: 0,
        claimCatalog,
        previousOutputs: [],
        metrics
      });

      this.ensureMinParticipants(normalized, initialOutputs.length);
      rounds.push({ round: 0, outputs: initialOutputs });
      claimCatalog = this.mergeClaims(claimCatalog, initialOutputs);

      let previousOutputs = initialOutputs;
      for (let round = 1; round <= normalized.roundPolicy.maxRounds; round += 1) {
        const debateOutputs = await this.runRound({
          normalized,
          sessionId,
          participantSessionMap,
          phase: "debate",
          round,
          claimCatalog,
          previousOutputs,
          metrics
        });

        this.ensureMinParticipants(normalized, debateOutputs.length);
        rounds.push({ round, outputs: debateOutputs });

        claimCatalog = this.applyRevisions(claimCatalog, debateOutputs);
        previousOutputs = debateOutputs;
      }

      await this.emit(normalized, sessionId, "ConsensusDrafted", {
        claimCount: claimCatalog.length
      });

      const finalVoteRound = normalized.roundPolicy.maxRounds + 1;
      const finalVoteOutputs = await this.runRound({
        normalized,
        sessionId,
        participantSessionMap,
        phase: "final_vote",
        round: finalVoteRound,
        claimCatalog,
        previousOutputs,
        metrics
      });
      this.ensureMinParticipants(normalized, finalVoteOutputs.length);
      rounds.push({ round: finalVoteRound, outputs: finalVoteOutputs });

      const scoreboard = computeParticipantScores({
        participants,
        rounds,
        scoringPolicy: normalized.scoringPolicy
      });

      const representative = chooseRepresentative({
        scores: scoreboard,
        rounds,
        tieBreaker: normalized.scoringPolicy.tieBreaker
      });

      const representativeSpeech = this.pickRepresentativeSpeech(representative.participantId, rounds);

      const votes = finalVoteOutputs
        .filter((output) => typeof output.vote === "string")
        .map((output) => ({
          participantId: output.participantId,
          vote: output.vote as "accept" | "reject",
          reason: output.summary
        }));

      const accepts = votes.filter((vote) => vote.vote === "accept").length;
      const rejects = votes.filter((vote) => vote.vote === "reject").length;

      state.transition("finalizing");
      await this.store.update(sessionId, {
        state: state.current,
        finalizingAt: new Date(this.now()).toISOString()
      });

      const status: ArgueResult["status"] = accepts >= normalized.participantsPolicy.minParticipants && rejects === 0
        ? "consensus"
        : "unresolved";

      const report = await this.composeReport({
        normalized,
        requestId: normalized.requestId,
        sessionId,
        representative: {
          participantId: representative.participantId,
          speech: representativeSpeech,
          score: representative.score
        },
        rounds,
        votes,
        scoreboard,
        status
      });

      const result: ArgueResult = ArgueResultSchema.parse({
        requestId: normalized.requestId,
        sessionId,
        status,
        finalClaims: claimCatalog,
        representative: {
          participantId: representative.participantId,
          reason: representative.reason,
          score: representative.score,
          speech: representativeSpeech
        },
        scoreboard,
        votes,
        report,
        disagreements: collectDisagreements(rounds),
        rounds,
        metrics: {
          elapsedMs: Math.max(0, this.now() - startAt),
          totalTurns: metrics.totalTurns,
          retries: metrics.retries,
          waitTimeouts: metrics.waitTimeouts
        }
      });

      state.transition("finished");
      await this.store.update(sessionId, {
        state: state.current,
        result,
        finishedAt: new Date(this.now()).toISOString()
      });

      await this.emit(normalized, sessionId, "Finalized", {
        status,
        representative: representative.participantId
      });

      return result;
    } catch (error) {
      await this.handleFailure({
        error,
        normalized,
        sessionId,
        state
      });
      throw error;
    }
  }

  private async runRound(args: {
    normalized: NormalizedArgueStartInput;
    sessionId: string;
    participantSessionMap: Map<string, string>;
    phase: Phase;
    round: number;
    claimCatalog: Claim[];
    previousOutputs: ParticipantRoundOutput[];
    metrics: {
      retries: number;
      waitTimeouts: number;
      totalTurns: number;
    };
  }): Promise<ParticipantRoundOutput[]> {
    const dispatches = await Promise.all(args.normalized.participants.map(async (participant) => {
      const peerRoundInputs = args.previousOutputs
        .filter((output) => output.participantId !== participant.id)
        .slice(0, args.normalized.peerContextPolicy.maxPeersPerRound ?? Number.MAX_SAFE_INTEGER)
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

      const task = RoundTaskInputSchema.parse({
        sessionId: args.sessionId,
        requestId: args.normalized.requestId,
        participantId: participant.id,
        phase: args.phase,
        round: args.round,
        prompt: this.buildPrompt(args.normalized, args.phase, args.round),
        selfHistoryRef: { stickySession: true },
        peerRoundInputs,
        claimCatalog: args.claimCatalog,
        metadata: {
          participantSessionKey: args.participantSessionMap.get(participant.id),
          role: participant.role,
          peerContextPassMode: args.normalized.peerContextPolicy.passMode,
          constraints: args.normalized.constraints,
          context: args.normalized.context
        }
      });

      return this.deps.taskDelegate.dispatch(task);
    }));

    const taskIds = dispatches.map((dispatch) => dispatch.taskId);

    await this.emit(args.normalized, args.sessionId, "RoundDispatched", {
      phase: args.phase,
      round: args.round,
      taskIds
    });

    const waited = await this.waitCoordinator.waitRound({
      round: args.round,
      taskIds,
      policy: args.normalized.waitingPolicy
    });

    args.metrics.waitTimeouts += waited.timedOutTaskIds.length;

    for (const output of waited.completed) {
      args.metrics.totalTurns += 1;
      await this.emit(args.normalized, args.sessionId, "ParticipantResponded", {
        phase: args.phase,
        round: args.round,
        participantId: output.participantId
      });
    }

    await this.emit(args.normalized, args.sessionId, "RoundCompleted", {
      phase: args.phase,
      round: args.round,
      completed: waited.completed.length,
      timedOut: waited.timedOutTaskIds.length,
      failed: waited.failedTaskIds.length
    });

    return waited.completed
      .filter((output) => output.phase === args.phase && output.round === args.round)
      .filter((output) => args.normalized.participants.some((participant) => participant.id === output.participantId));
  }

  private mergeClaims(base: Claim[], outputs: ParticipantRoundOutput[]): Claim[] {
    const claimMap = new Map<string, Claim>(base.map((claim) => [claim.claimId, claim]));

    for (const output of outputs) {
      for (const claim of output.extractedClaims ?? []) {
        if (!claimMap.has(claim.claimId)) {
          claimMap.set(claim.claimId, claim);
        }
      }
    }

    if (claimMap.size === 0) {
      for (const output of outputs) {
        claimMap.set(`seed:${output.participantId}:${output.round}`, {
          claimId: `seed:${output.participantId}:${output.round}`,
          title: `Seed from ${output.participantId}`,
          statement: output.summary,
          category: "todo"
        });
      }
    }

    return [...claimMap.values()];
  }

  private applyRevisions(base: Claim[], outputs: ParticipantRoundOutput[]): Claim[] {
    const claimMap = new Map<string, Claim>(base.map((claim) => [claim.claimId, claim]));

    for (const output of outputs) {
      for (const judgement of output.judgements) {
        const claim = claimMap.get(judgement.claimId);
        if (!claim) continue;

        if (judgement.revisedStatement && (judgement.stance === "revise" || judgement.stance === "disagree")) {
          claimMap.set(judgement.claimId, {
            ...claim,
            statement: judgement.revisedStatement
          });
        }
      }
    }

    return [...claimMap.values()];
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

  private ensureMinParticipants(normalized: NormalizedArgueStartInput, completedCount: number): void {
    if (completedCount >= normalized.participantsPolicy.minParticipants) return;
    throw new Error(
      `Round failed minimum participant requirement: completed=${completedCount}, required=${normalized.participantsPolicy.minParticipants}`
    );
  }

  private buildPrompt(input: NormalizedArgueStartInput, phase: Phase, round: number): string {
    const lines = [
      `phase=${phase}`,
      `round=${round}`,
      `topic=${input.topic}`,
      `objective=${input.objective}`,
      "Use claim-level judgements for all relevant claims."
    ];

    if (input.constraints?.language) {
      lines.push(`language=${input.constraints.language}`);
    }

    if (typeof input.constraints?.tokenBudgetHint === "number") {
      lines.push(`token_budget_hint=${input.constraints.tokenBudgetHint}`);
    }

    return lines.join("\n");
  }

  private async composeReport(args: {
    normalized: NormalizedArgueStartInput;
    requestId: string;
    sessionId: string;
    representative: { participantId: string; speech: string; score: number };
    rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }>;
    votes: Array<{ participantId: string; vote: "accept" | "reject"; reason?: string }>;
    scoreboard: ParticipantScore[];
    status: "consensus" | "unresolved" | "failed";
  }) {
    if (args.normalized.reportPolicy.composer === "delegate-agent" && this.deps.reportComposer) {
      return this.deps.reportComposer.compose({
        requestId: args.requestId,
        sessionId: args.sessionId,
        representative: args.representative,
        rounds: args.rounds,
        votes: args.votes,
        scoreboard: args.scoreboard,
        policy: args.normalized.reportPolicy
      });
    }

    return buildBuiltinReport({
      includeDeliberationTrace: args.normalized.reportPolicy.includeDeliberationTrace,
      traceLevel: args.normalized.reportPolicy.traceLevel,
      status: args.status,
      representativeSpeech: args.representative.speech,
      rounds: args.rounds,
      representativeId: args.representative.participantId
    });
  }

  private async handleFailure(args: {
    error: unknown;
    normalized: NormalizedArgueStartInput;
    sessionId: string;
    state: ArgueStateMachine;
  }): Promise<void> {
    if (args.state.current === "finished" || args.state.current === "failed") {
      return;
    }

    args.state.transition("failed");
    const failure = toFailureInfo(args.error);

    await Promise.allSettled([
      this.store.update(args.sessionId, {
        state: args.state.current,
        error: failure,
        failedAt: new Date(this.now()).toISOString()
      }),
      this.emit(args.normalized, args.sessionId, "Failed", failure)
    ]);
  }

  private async emit(
    normalized: NormalizedArgueStartInput,
    sessionId: string,
    type: "SessionStarted" | "RoundDispatched" | "ParticipantResponded" | "RoundCompleted" | "ConsensusDrafted" | "Finalized" | "Failed",
    payload?: Record<string, unknown>
  ): Promise<void> {
    if (!this.deps.observer) return;

    await this.deps.observer.onEvent({
      sessionId,
      requestId: normalized.requestId,
      type,
      at: new Date(this.now()).toISOString(),
      payload
    });
  }
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
