import { access, readdir } from "node:fs/promises";

// Looser pattern used for on-disk discovery: matches any argue_<ms> or argue_<ms>_<6chars>
// directory name, regardless of the suffix charset. REQUEST_ID_PATTERN is the strict
// producer-side pattern; legacy or future variants may have different suffix characters.
const DISCOVERY_PATTERN = /^argue_\d+(?:_[a-zA-Z0-9]{6})?$/;

export type CompletedRun = {
  requestId: string;
  resultPath: string;
};

/**
 * Given a resolved resultPath template like "/abs/out/{requestId}/result.json",
 * enumerate completed runs by scanning the segment containing {requestId}.
 * Only entries whose name matches REQUEST_ID_PATTERN AND that have a readable
 * result.json at the expected location are returned, sorted ascending.
 */
export async function listCompletedRuns(resolvedResultTemplate: string): Promise<CompletedRun[]> {
  const token = "{requestId}";
  const tokenIdx = resolvedResultTemplate.indexOf(token);
  if (tokenIdx === -1) return [];

  // The scan dir is the path prefix up to (but not including) the {requestId} segment.
  // We assume the default layout where {requestId} occupies a full path segment.
  const prefixSlash = resolvedResultTemplate.lastIndexOf("/", tokenIdx - 1);
  if (prefixSlash === -1) return [];
  const scanDir = resolvedResultTemplate.slice(0, prefixSlash);

  let entries;
  try {
    entries = await readdir(scanDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: CompletedRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!DISCOVERY_PATTERN.test(entry.name)) continue;
    const resultPath = resolvedResultTemplate.replaceAll(token, entry.name);
    if (!(await pathExists(resultPath))) continue;
    candidates.push({ requestId: entry.name, resultPath });
  }

  candidates.sort((a, b) => (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0));
  return candidates;
}

export async function resolveLatestRequestId(resolvedResultTemplate: string): Promise<CompletedRun | null> {
  const runs = await listCompletedRuns(resolvedResultTemplate);
  return runs.length > 0 ? runs[runs.length - 1]! : null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
