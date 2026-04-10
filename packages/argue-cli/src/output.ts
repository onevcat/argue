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

      if (result.report.representativeSpeech && verbose) {
        io.log("");
        io.log(c.bold("  Representative speech:"));
        io.log(`  ${result.report.representativeSpeech}`);
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
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
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
