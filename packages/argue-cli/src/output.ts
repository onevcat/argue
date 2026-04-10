import pc from "picocolors";
import type { ArgueEvent, ArgueResult } from "argue";

export type OutputOptions = {
  verbose?: boolean;
  noColor?: boolean;
  isTTY?: boolean;
};

export type OutputIO = Pick<typeof console, "log" | "error">;

export function createOutputFormatter(io: OutputIO, options: OutputOptions = {}) {
  const useColor = !options.noColor && !process.env.NO_COLOR && (options.isTTY ?? process.stdout.isTTY ?? false);

  const c = useColor
    ? pc
    : {
      cyan: (s: string) => s,
      dim: (s: string) => s,
      green: (s: string) => s,
      red: (s: string) => s,
      yellow: (s: string) => s,
      bold: (s: string) => s,
      magenta: (s: string) => s,
      white: (s: string) => s,
      blue: (s: string) => s
    };

  const tag = c.cyan("[argue]");
  const verbose = options.verbose ?? false;

  function stanceIcon(stance: string): string {
    if (stance === "agree") return c.green("✓");
    if (stance === "disagree") return c.red("✗");
    if (stance === "revise") return c.yellow("↻");
    return "?";
  }

  function voteIcon(vote: string): string {
    return vote === "accept" ? c.green("accept") : c.red("reject");
  }

  function indent(text: string, prefix: string): string {
    return text.split("\n").map((line) => `${prefix}${line}`).join("\n");
  }

  return {
    planResolved(args: {
      configPath: string;
      requestId: string;
      task: string;
      agents: string[];
      rounds: string;
      composer: string;
      jsonlPath: string;
    }) {
      io.log(`${tag} ${c.bold("run started")}`);
      io.log(c.dim(`  config: ${args.configPath}`));
      io.log(c.dim(`  requestId: ${args.requestId}`));
      io.log(`  task: ${args.task}`);
      io.log(`  agents: ${args.agents.join(", ")}`);
      io.log(c.dim(`  rounds: ${args.rounds} | composer: ${args.composer}`));
      io.log(c.dim(`  events: ${args.jsonlPath}`));
    },

    createEventHandler(): (event: ArgueEvent) => void {
      return (event) => {
        const payload = event.payload ?? {};
        const phase = readString(payload.phase);
        const round = readNumber(payload.round);
        const roundTag = formatRoundTag(phase, round);

        if (event.type === "RoundDispatched") {
          const participants = readStringArray(payload.participants);
          io.log(`${tag} ${c.bold(roundTag)} dispatched ${c.dim("-> " + participants.join(", "))}`);
          return;
        }

        if (event.type === "ParticipantResponded") {
          const participantId = readString(payload.participantId) ?? "unknown";
          const extractedClaims = readNumber(payload.extractedClaims) ?? 0;
          const stanceAgree = readNumber(payload.stanceAgree) ?? 0;
          const stanceDisagree = readNumber(payload.stanceDisagree) ?? 0;
          const stanceRevise = readNumber(payload.stanceRevise) ?? 0;
          const claimVotes = readNumber(payload.claimVotes) ?? 0;
          const judgementParts = [
            stanceAgree > 0 ? `${stanceAgree}✓` : null,
            stanceDisagree > 0 ? `${stanceDisagree}✗` : null,
            stanceRevise > 0 ? `${stanceRevise}↻` : null
          ].filter(Boolean).join(" ");
          const judgementStr = judgementParts || "0";
          const stats = c.dim(`(claims+${extractedClaims}, judgements=${judgementStr}, votes=${claimVotes})`);
          io.log(`${tag} ${c.bold(roundTag)} ${c.blue(participantId)} responded ${stats}`);

          const summary = readString(payload.summary);
          if (summary) {
            io.log(c.dim(`  ${singleLine(summary)}`));
          }

          if (verbose) {
            printVerboseResponse(payload);
          }
          return;
        }

        if (event.type === "ParticipantEliminated") {
          const participantId = readString(payload.participantId) ?? "unknown";
          const reason = readString(payload.reason) ?? "unknown";
          io.log(`${tag} ${c.bold(roundTag)} ${c.red(`${participantId} eliminated`)} ${c.dim(`(${reason})`)}`);
          return;
        }

        if (event.type === "ClaimsMerged") {
          const source = readString(payload.sourceClaimId) ?? "?";
          const mergedInto = readString(payload.mergedInto) ?? "?";
          io.log(`${tag} ${c.bold(roundTag)} ${c.yellow(`claim merged ${source} -> ${mergedInto}`)}`);
          return;
        }

        if (event.type === "RoundCompleted") {
          const completed = readNumber(payload.completed) ?? 0;
          const timedOut = readNumber(payload.timedOut) ?? 0;
          const failed = readNumber(payload.failed) ?? 0;
          const claimCatalogSize = readNumber(payload.claimCatalogSize) ?? 0;
          const newClaims = readNumber(payload.newClaims) ?? 0;
          const mergeCount = readNumber(payload.mergeCount) ?? 0;
          io.log(
            c.dim(`${tag} ${roundTag} completed: done=${completed} timeout=${timedOut} failed=${failed} claims=${claimCatalogSize} (+${newClaims}, -${mergeCount})`)
          );
          return;
        }

        if (event.type === "GlobalDeadlineHit") {
          io.log(`${tag} ${c.red("global deadline hit")}`);
          return;
        }

        if (event.type === "EarlyStopTriggered") {
          io.log(`${tag} ${c.yellow(`early stop triggered at ${roundTag}`)}`);
          return;
        }

        if (event.type === "ReportDispatched") {
          const reporterId = readString(payload.reporterId) ?? "unknown";
          io.log(`${tag} ${c.magenta(`report dispatched -> ${reporterId}`)}`);
          return;
        }

        if (event.type === "ReportCompleted") {
          const mode = readString(payload.mode) ?? "unknown";
          const reason = readString(payload.reason);
          const suffix = reason ? c.dim(` (fallback: ${reason})`) : "";
          io.log(`${tag} ${c.magenta(`report completed: ${mode}`)}${suffix}`);
        }
      };
    },

    runCompleted(result: ArgueResult, paths: { resultPath: string; summaryPath: string }) {
      io.log("");
      io.log(c.dim("─".repeat(60)));
      io.log("");

      const statusColor = result.status === "consensus" ? c.green : result.status === "partial_consensus" ? c.yellow : c.red;
      io.log(`${tag} ${c.bold("result:")} ${statusColor(result.status)}`);
      io.log(`  representative: ${c.bold(result.representative.participantId)} ${c.dim(`(score: ${formatNumber(result.representative.score)})`)}`);

      if (result.report.finalSummary) {
        io.log("");
        io.log(c.bold("  Conclusion:"));
        io.log(`  ${result.report.finalSummary}`);
      }

      if (verbose) {
        printVerboseResult(result);
      }

      io.log("");
      io.log(c.dim(`  result: ${paths.resultPath}`));
      io.log(c.dim(`  summary: ${paths.summaryPath}`));
    },

    runFailed(error: unknown, errorPath: string) {
      io.log("");
      io.log(c.dim("─".repeat(60)));
      io.log("");
      io.error(`${tag} ${c.red(c.bold("run failed"))}: ${String(error)}`);
      io.log(c.dim(`  error: ${errorPath}`));
    }
  };

  function printVerboseResponse(payload: Record<string, unknown>): void {
    // Extracted claims
    const claims = readArray(payload.extractedClaimsDetail);
    if (claims.length > 0) {
      io.log(c.dim("  ┌ extracted claims:"));
      for (const claim of claims) {
        const obj = claim as Record<string, unknown>;
        const id = readString(obj.claimId) ?? "?";
        const title = readString(obj.title) ?? "";
        const category = readString(obj.category);
        const catTag = category ? c.dim(` [${category}]`) : "";
        io.log(c.dim(`  │ ${c.bold(id)}: ${title}${catTag}`));
        const statement = readString(obj.statement);
        if (statement) {
          io.log(c.dim(`  │   ${singleLine(statement)}`));
        }
      }
      io.log(c.dim("  └"));
    }

    // Judgements
    const judgements = readArray(payload.judgementsDetail);
    if (judgements.length > 0) {
      io.log(c.dim("  ┌ judgements:"));
      for (const j of judgements) {
        const obj = j as Record<string, unknown>;
        const claimId = readString(obj.claimId) ?? "?";
        const stance = readString(obj.stance) ?? "?";
        const confidence = readNumber(obj.confidence);
        const confStr = confidence !== undefined ? c.dim(` (${(confidence * 100).toFixed(0)}%)`) : "";
        io.log(`  │ ${stanceIcon(stance)} ${c.bold(claimId)}${confStr}`);
        const rationale = readString(obj.rationale);
        if (rationale) {
          io.log(c.dim(`  │   ${singleLine(rationale)}`));
        }
        const revised = readString(obj.revisedStatement);
        if (revised) {
          io.log(c.dim(`  │   ${c.yellow("revised:")} ${singleLine(revised)}`));
        }
      }
      io.log(c.dim("  └"));
    }

    // Claim votes (final_vote phase)
    const votes = readArray(payload.claimVotesDetail);
    if (votes.length > 0) {
      io.log(c.dim("  ┌ votes:"));
      for (const v of votes) {
        const obj = v as Record<string, unknown>;
        const claimId = readString(obj.claimId) ?? "?";
        const vote = readString(obj.vote) ?? "?";
        const reason = readString(obj.reason);
        const reasonStr = reason ? c.dim(` — ${singleLine(reason)}`) : "";
        io.log(`  │ ${voteIcon(vote)} ${c.bold(claimId)}${reasonStr}`);
      }
      io.log(c.dim("  └"));
    }

    // Full response
    const fullResponse = readString(payload.fullResponse);
    if (fullResponse) {
      io.log(c.dim("  ┌ full response:"));
      io.log(indent(c.dim(fullResponse), "  │ "));
      io.log(c.dim("  └"));
    }
  }

  function printVerboseResult(result: ArgueResult): void {
    // Representative speech
    if (result.report.representativeSpeech) {
      io.log("");
      io.log(c.bold("  Representative speech:"));
      io.log(`  ${result.report.representativeSpeech}`);
    }

    // Scoreboard
    if (result.scoreboard.length > 0) {
      io.log("");
      io.log(c.bold("  Scoreboard:"));
      const sorted = [...result.scoreboard].sort((a, b) => b.total - a.total);
      for (const entry of sorted) {
        const breakdown = entry.breakdown;
        const parts: string[] = [];
        if (breakdown?.correctness !== undefined) parts.push(`cor=${formatNumber(breakdown.correctness)}`);
        if (breakdown?.completeness !== undefined) parts.push(`cpl=${formatNumber(breakdown.completeness)}`);
        if (breakdown?.actionability !== undefined) parts.push(`act=${formatNumber(breakdown.actionability)}`);
        if (breakdown?.consistency !== undefined) parts.push(`con=${formatNumber(breakdown.consistency)}`);
        const breakdownStr = parts.length > 0 ? c.dim(` (${parts.join(", ")})`) : "";
        io.log(`  ${c.bold(entry.participantId)}: ${formatNumber(entry.total)}${breakdownStr}`);
      }
    }

    // Final claims
    if (result.finalClaims.length > 0) {
      io.log("");
      io.log(c.bold("  Claims:"));
      for (const claim of result.finalClaims) {
        const catTag = claim.category ? c.dim(` [${claim.category}]`) : "";
        const statusTag = claim.status !== "active" ? c.dim(` (${claim.status})`) : "";
        io.log(`  ${c.bold(claim.claimId)}: ${claim.title}${catTag}${statusTag}`);
        io.log(c.dim(`    ${claim.statement}`));
        io.log(c.dim(`    proposed by: ${claim.proposedBy.join(", ")}`));

        // Show resolution for this claim
        const resolution = result.claimResolutions.find((r) => r.claimId === claim.claimId);
        if (resolution) {
          const resColor = resolution.status === "resolved" ? c.green : c.red;
          io.log(`    ${resColor(resolution.status)}: ${resolution.acceptCount}/${resolution.totalVoters} accept, ${resolution.rejectCount}/${resolution.totalVoters} reject`);
        }
      }
    }

    // Disagreements
    if (result.disagreements && result.disagreements.length > 0) {
      io.log("");
      io.log(c.bold("  Disagreements:"));
      for (const d of result.disagreements) {
        io.log(`  ${c.red("✗")} ${c.bold(d.claimId)} by ${d.participantId}: ${d.reason}`);
      }
    }

    // Eliminations
    if (result.eliminations.length > 0) {
      io.log("");
      io.log(c.bold("  Eliminations:"));
      for (const e of result.eliminations) {
        io.log(`  ${c.red(e.participantId)} at round ${e.round} (${e.reason})`);
      }
    }

    // Metrics
    io.log("");
    io.log(c.bold("  Metrics:"));
    const m = result.metrics;
    io.log(c.dim(`  elapsed=${formatMs(m.elapsedMs)} rounds=${m.totalRounds} turns=${m.totalTurns} retries=${m.retries} timeouts=${m.waitTimeouts}`));
    if (m.earlyStopTriggered) io.log(c.dim("  early stop: yes"));
    if (m.globalDeadlineHit) io.log(c.dim("  global deadline hit: yes"));
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function formatRoundTag(phase: string | undefined, round: number | undefined): string {
  if (phase !== undefined && round !== undefined) return `${phase}#${round}`;
  if (phase !== undefined) return phase;
  if (round !== undefined) return `#${round}`;
  return "unknown";
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m${seconds}s`;
}
