import { access, readdir } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { REQUEST_ID_PATTERN } from "./request-id.js";

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
    if (!REQUEST_ID_PATTERN.test(entry.name)) continue;
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

/**
 * URL fragment budget. macOS ARG_MAX is ~256KB; browsers tolerate much more,
 * but we need the full URL to pass through argv when calling `open`. Leave a
 * generous margin for the URL prefix + env + child arg list overhead.
 */
export const MAX_ENCODED_BYTES = 200_000;

export function encodeReportForUrl(reportJson: string): string {
  return gzipSync(Buffer.from(reportJson, "utf8")).toString("base64url");
}

export type BuildViewerUrlInput = {
  viewerUrl: string;
  reportJson: string;
};

export type BuildViewerUrlResult =
  | { ok: true; url: string; encodedSize: number }
  | { ok: false; reason: "too-large"; encodedSize: number };

export function buildViewerUrl(input: BuildViewerUrlInput): BuildViewerUrlResult {
  const encoded = encodeReportForUrl(input.reportJson);
  const size = encoded.length;
  if (size > MAX_ENCODED_BYTES) {
    return { ok: false, reason: "too-large", encodedSize: size };
  }
  const base = input.viewerUrl.endsWith("/") ? input.viewerUrl : `${input.viewerUrl}/`;
  return { ok: true, url: `${base}#v=1&d=${encoded}`, encodedSize: size };
}

export type BrowserSpawnFn = (cmd: string, args: string[]) => void;

export type LaunchBrowserOptions = {
  platform?: NodeJS.Platform | string;
  spawn?: BrowserSpawnFn;
};

export function launchBrowser(url: string, options: LaunchBrowserOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const spawn =
    options.spawn ??
    ((cmd: string, args: string[]): void => {
      const child = nodeSpawn(cmd, args, { stdio: "ignore", detached: true });
      child.unref();
    });

  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "linux") {
    cmd = "xdg-open";
    args = [url];
  } else if (platform === "win32") {
    // `start` is a cmd.exe builtin; first quoted arg is the window title (empty).
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    return Promise.reject(new Error(`Unsupported platform for launchBrowser: ${platform}`));
  }

  spawn(cmd, args);
  return Promise.resolve();
}
