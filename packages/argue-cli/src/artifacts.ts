import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArgueResult } from "argue";

export async function writeRunArtifacts(args: {
  result: ArgueResult;
  resultPath: string;
  summaryPath: string;
}): Promise<void> {
  await Promise.all([
    writeJsonFile(args.resultPath, args.result),
    writeTextFile(args.summaryPath, buildResultSummary(args.result))
  ]);
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m${seconds}s`;
}

export function buildResultSummary(result: ArgueResult): string {
  const activeClaims = result.finalClaims.filter((c) => c.status === "active");
  const resolvedCount = result.claimResolutions.filter((r) => r.status === "resolved").length;
  const { metrics } = result;

  const lines: string[] = [];

  // --- Metadata ---
  lines.push(
    `# argue run ${result.requestId}`,
    "",
    `- status: ${result.status}`,
    `- representative: ${result.representative.participantId} (${result.representative.reason}, score=${formatNumber(result.representative.score)})`,
    `- elapsed: ${formatMs(metrics.elapsedMs)}`,
    `- rounds: ${metrics.totalRounds}`,
    `- turns: ${metrics.totalTurns}`,
    `- claims: ${activeClaims.length} active / ${result.finalClaims.length} total`,
    `- resolved: ${resolvedCount}/${result.claimResolutions.length}`
  );

  // --- Conclusion ---
  lines.push("", "## Conclusion", "", result.report.finalSummary);

  // --- Representative Statement ---
  lines.push("", "## Representative Statement", "", result.report.representativeSpeech);

  // --- Claims ---
  if (activeClaims.length > 0) {
    const resolutionMap = new Map(
      result.claimResolutions.map((r) => [r.claimId, r])
    );

    // Build a map of last-round judgements per participant per claim
    const lastRound = result.rounds.length > 0
      ? result.rounds.reduce((a, b) => a.round > b.round ? a : b)
      : undefined;

    const stanceMap = new Map<string, Map<string, { stance: string; confidence: number }>>();
    if (lastRound) {
      for (const output of lastRound.outputs) {
        for (const j of output.judgements) {
          let claimStances = stanceMap.get(j.claimId);
          if (!claimStances) {
            claimStances = new Map();
            stanceMap.set(j.claimId, claimStances);
          }
          claimStances.set(output.participantId, {
            stance: j.stance,
            confidence: j.confidence
          });
        }
      }
    }

    lines.push("", "## Claims");

    for (const claim of activeClaims) {
      lines.push("", `### ${claim.title}`, "", claim.statement);

      if (claim.category) {
        lines.push(`- category: ${claim.category}`);
      }

      const resolution = resolutionMap.get(claim.claimId);
      if (resolution) {
        lines.push(`- accept: ${resolution.acceptCount} / reject: ${resolution.rejectCount}`);
      }

      const claimStances = stanceMap.get(claim.claimId);
      if (claimStances && claimStances.size > 0) {
        lines.push("- stances:");
        for (const [pid, s] of claimStances) {
          lines.push(`  - ${pid}: ${s.stance} (${s.confidence.toFixed(2)})`);
        }
      }
    }
  }

  // --- Scoreboard ---
  const sorted = [...result.scoreboard].sort((a, b) => b.total - a.total);
  if (sorted.length > 0) {
    lines.push("", "## Scoreboard", "");
    for (const entry of sorted) {
      let line = `- ${entry.participantId} | ${entry.total.toFixed(2)}`;
      if (entry.breakdown) {
        const parts: string[] = [];
        if (entry.breakdown.correctness != null) parts.push(`correctness=${formatNumber(entry.breakdown.correctness)}`);
        if (entry.breakdown.completeness != null) parts.push(`completeness=${formatNumber(entry.breakdown.completeness)}`);
        if (entry.breakdown.actionability != null) parts.push(`actionability=${formatNumber(entry.breakdown.actionability)}`);
        if (entry.breakdown.consistency != null) parts.push(`consistency=${formatNumber(entry.breakdown.consistency)}`);
        if (parts.length > 0) {
          line += ` (${parts.join(", ")})`;
        }
      }
      lines.push(line);
    }
  }

  // --- Disagreements ---
  if (result.disagreements && result.disagreements.length > 0) {
    lines.push("", "## Disagreements", "");
    for (const d of result.disagreements) {
      lines.push(`- ${d.claimId} — ${d.participantId}: ${d.reason}`);
    }
  }

  // --- Eliminations ---
  if (result.eliminations.length > 0) {
    lines.push("", "## Eliminations", "");
    for (const e of result.eliminations) {
      lines.push(`- ${e.participantId}: ${e.reason} (round ${e.round})`);
    }
  }

  // --- Metrics ---
  lines.push(
    "",
    "## Metrics",
    "",
    `- elapsed: ${formatMs(metrics.elapsedMs)}`,
    `- rounds: ${metrics.totalRounds}`,
    `- turns: ${metrics.totalTurns}`,
    `- retries: ${metrics.retries}`,
    `- timeouts: ${metrics.waitTimeouts}`,
    `- early stop: ${metrics.earlyStopTriggered ? "yes" : "no"}`,
    `- global deadline: ${metrics.globalDeadlineHit ? "yes" : "no"}`
  );

  return lines.join("\n");
}

export async function writeErrorArtifact(args: {
  errorPath: string;
  requestId: string;
  error: unknown;
}): Promise<void> {
  await writeJsonFile(args.errorPath, {
    requestId: args.requestId,
    error: args.error instanceof Error ? args.error.message : String(args.error),
    stack: args.error instanceof Error ? args.error.stack : undefined,
    at: new Date().toISOString()
  });
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextFile(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
