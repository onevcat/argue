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

export function buildResultSummary(result: ArgueResult): string {
  const lines = [
    `# argue run ${result.requestId}`,
    "",
    `- status: ${result.status}`,
    `- representative: ${result.representative.participantId} (${result.representative.reason}, score=${formatNumber(result.representative.score)})`,
    `- total rounds: ${result.metrics.totalRounds}`,
    `- total turns: ${result.metrics.totalTurns}`,
    `- claims: ${result.finalClaims.filter((claim) => claim.status === "active").length} active / ${result.finalClaims.length} total`,
    `- resolved claims: ${result.claimResolutions.filter((item) => item.status === "resolved").length}/${result.claimResolutions.length}`,
    `- eliminations: ${result.eliminations.length}`
  ];

  if (result.eliminations.length > 0) {
    lines.push("", "## Eliminations");
    for (const elimination of result.eliminations) {
      lines.push(`- ${elimination.participantId}: ${elimination.reason} at round ${elimination.round}`);
    }
  }

  lines.push("", "## Summary", "", result.report.finalSummary);
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
