import type { AgentTaskInput, Claim } from "argue";
import type { MockProviderConfig } from "../config.js";
import type { ProviderTaskRunner, ResolvedAgentRuntime } from "./types.js";

type MockAction = NonNullable<MockProviderConfig["defaultBehavior"]>;

export function createMockRunner(provider: MockProviderConfig): ProviderTaskRunner {
  return {
    async runTask({ task, agent, abortSignal }) {
      const action = resolveAction(provider, task, agent);

      if (action.delayMs && action.delayMs > 0) {
        await delay(action.delayMs, abortSignal);
      }

      switch (action.behavior) {
      case "timeout":
        return pendingUntilAbort(abortSignal);
      case "error":
        throw new Error(action.error ?? `Mock error from ${task.participantId}`);
      case "malformed":
        return { malformed: true };
      case "deterministic":
      default:
        return buildDeterministicOutput(task, agent);
      }
    }
  };
}

function resolveAction(provider: MockProviderConfig, task: AgentTaskInput, agent: ResolvedAgentRuntime): MockAction {
  const scenario = provider.participants?.[agent.id] ?? provider.participants?.[task.participantId];
  const phase = task.kind === "report" ? "report" : task.kind === "action" ? "action" : task.phase;
  return scenario?.[phase] ?? provider.defaultBehavior ?? { behavior: "deterministic" };
}

function buildDeterministicOutput(task: AgentTaskInput, agent: ResolvedAgentRuntime): unknown {
  if (task.kind === "report") {
    return {
      mode: "representative",
      traceIncluded: task.reportInput.rounds.length > 0,
      traceLevel: "compact",
      finalSummary: `Mock summary for ${task.requestId} by ${agent.id}.`,
      representativeSpeech: `Representative speech from ${agent.id}.`
    };
  }

  if (task.kind === "action") {
    return {
      fullResponse: `Action completed by ${agent.id}.`,
      summary: `Action completed by ${agent.id}.`
    };
  }

  const roleSuffix = agent.role ? ` (${agent.role})` : "";

  if (task.phase === "initial") {
    return {
      fullResponse: `Initial analysis from ${agent.id}${roleSuffix}.`,
      summary: `Initial position from ${agent.id}.`,
      extractedClaims: [
        {
          claimId: `${agent.id}-claim-0`,
          title: `Proposal from ${agent.id}`,
          statement: `${agent.id}${roleSuffix} recommends a concrete next step.`,
          category: "pro"
        }
      ],
      judgements: []
    };
  }

  if (task.phase === "debate") {
    return {
      fullResponse: `Debate response from ${agent.id}.`,
      summary: `Debate stance from ${agent.id}.`,
      judgements: (task.claimCatalog ?? []).map((claim: Claim) => ({
        claimId: claim.claimId,
        stance: "agree",
        confidence: 0.9,
        rationale: `${agent.id} agrees with ${claim.claimId}.`
      }))
    };
  }

  return {
    fullResponse: `Final vote from ${agent.id}.`,
    summary: `Final vote from ${agent.id}.`,
    judgements: (task.claimCatalog ?? []).map((claim: Claim) => ({
      claimId: claim.claimId,
      stance: "agree",
      confidence: 0.95,
      rationale: `${agent.id} accepts ${claim.claimId}.`
    })),
    claimVotes: (task.claimCatalog ?? []).map((claim: Claim) => ({
      claimId: claim.claimId,
      vote: "accept",
      reason: `${agent.id} accepts ${claim.claimId}.`
    }))
  };
}

function pendingUntilAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    timer.unref?.();

    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
