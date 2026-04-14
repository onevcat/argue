import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildViewerUrl,
  encodeReportForUrl,
  launchBrowser,
  listCompletedRuns,
  MAX_ENCODED_BYTES,
  openReportInViewer,
  resolveLatestRequestId
} from "../src/view.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "argue-view-"));
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

async function makeRun(id: string, opts: { withResult?: boolean } = {}): Promise<void> {
  const runDir = join(tmpRoot, id);
  await mkdir(runDir, { recursive: true });
  if (opts.withResult ?? true) {
    await writeFile(join(runDir, "result.json"), "{}");
  }
}

describe("listCompletedRuns (directory-per-run layout)", () => {
  it("returns an empty list when the output dir does not exist", async () => {
    const missing = join(tmpRoot, "does-not-exist");
    const resultTemplate = join(missing, "{requestId}", "result.json");
    const runs = await listCompletedRuns(resultTemplate);
    expect(runs).toEqual([]);
  });

  it("discovers run dirs whose name matches REQUEST_ID_PATTERN", async () => {
    await makeRun("argue_1712000000000_a1b2c3");
    await makeRun("argue_1712000001000_deadbe");
    await makeRun("unrelated");
    const resultTemplate = join(tmpRoot, "{requestId}", "result.json");
    const runs = await listCompletedRuns(resultTemplate);
    expect(runs).toEqual([
      {
        requestId: "argue_1712000000000_a1b2c3",
        resultPath: join(tmpRoot, "argue_1712000000000_a1b2c3", "result.json")
      },
      {
        requestId: "argue_1712000001000_deadbe",
        resultPath: join(tmpRoot, "argue_1712000001000_deadbe", "result.json")
      }
    ]);
  });

  it("skips runs whose result.json is missing", async () => {
    await makeRun("argue_1712000000000_a1b2c3", { withResult: false });
    await makeRun("argue_1712000001000_deadbe");
    const resultTemplate = join(tmpRoot, "{requestId}", "result.json");
    const runs = await listCompletedRuns(resultTemplate);
    expect(runs.map((r) => r.requestId)).toEqual(["argue_1712000001000_deadbe"]);
  });

  it("sorts results lexicographically (= chronologically for our id format)", async () => {
    await makeRun("argue_1712000001000_aaaaaa");
    await makeRun("argue_1711000000000_eeeeee");
    await makeRun("argue_1712000000000_bbbbbb");
    const resultTemplate = join(tmpRoot, "{requestId}", "result.json");
    const runs = await listCompletedRuns(resultTemplate);
    expect(runs.map((r) => r.requestId)).toEqual([
      "argue_1711000000000_eeeeee",
      "argue_1712000000000_bbbbbb",
      "argue_1712000001000_aaaaaa"
    ]);
  });

  it("includes legacy ms-only requestIds", async () => {
    await makeRun("argue_1711000000000");
    await makeRun("argue_1712000000000_aaaaaa");
    const resultTemplate = join(tmpRoot, "{requestId}", "result.json");
    const runs = await listCompletedRuns(resultTemplate);
    expect(runs.map((r) => r.requestId)).toEqual(["argue_1711000000000", "argue_1712000000000_aaaaaa"]);
  });
});

describe("resolveLatestRequestId", () => {
  it("returns the lexicographically largest matching run", async () => {
    await makeRun("argue_1711000000000_aaaaaa");
    await makeRun("argue_1712000000000_aaaaaa");
    const resultTemplate = join(tmpRoot, "{requestId}", "result.json");
    const latest = await resolveLatestRequestId(resultTemplate);
    expect(latest).toEqual({
      requestId: "argue_1712000000000_aaaaaa",
      resultPath: join(tmpRoot, "argue_1712000000000_aaaaaa", "result.json")
    });
  });

  it("returns null when no completed runs exist", async () => {
    const resultTemplate = join(tmpRoot, "{requestId}", "result.json");
    const latest = await resolveLatestRequestId(resultTemplate);
    expect(latest).toBeNull();
  });
});

describe("encodeReportForUrl", () => {
  it("round-trips a JSON payload via gzip + base64url", () => {
    const payload = JSON.stringify({ hello: "world", n: 42 });
    const encoded = encodeReportForUrl(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = gunzipSync(Buffer.from(encoded, "base64url")).toString("utf8");
    expect(decoded).toBe(payload);
  });

  it("produces smaller output than the source for typical reports", () => {
    const big = JSON.stringify({ claims: Array.from({ length: 100 }, (_, i) => ({ id: i, body: "a".repeat(100) })) });
    const encoded = encodeReportForUrl(big);
    expect(encoded.length).toBeLessThan(big.length);
  });
});

describe("buildViewerUrl", () => {
  it("returns a normalized fragment URL with v=1 and d=<blob>", () => {
    const out = buildViewerUrl({ viewerUrl: "https://argue.onev.cat/", reportJson: '{"k":"v"}' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.url.startsWith("https://argue.onev.cat/#v=1&d=")).toBe(true);
  });

  it("normalizes viewerUrl with or without trailing slash to the same prefix", () => {
    const a = buildViewerUrl({ viewerUrl: "https://argue.onev.cat", reportJson: '{"k":"v"}' });
    const b = buildViewerUrl({ viewerUrl: "https://argue.onev.cat/", reportJson: '{"k":"v"}' });
    if (!a.ok || !b.ok) throw new Error("expected both ok");
    expect(a.url.replace(/#.*$/, "")).toBe(b.url.replace(/#.*$/, ""));
  });

  it("refuses payloads whose encoded size exceeds MAX_ENCODED_BYTES", () => {
    // Genuinely incompressible input: random bytes base64-encoded.
    // ~200KB of random bytes → ~266KB base64 → gzip cannot reduce →
    // final base64url of gzipped output is comfortably over MAX_ENCODED_BYTES.
    const incompressible = randomBytes(MAX_ENCODED_BYTES).toString("base64");
    const big = JSON.stringify({ blob: incompressible });
    const out = buildViewerUrl({ viewerUrl: "https://argue.onev.cat/", reportJson: big });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected refusal");
    expect(out.reason).toBe("too-large");
    expect(out.encodedSize).toBeGreaterThan(MAX_ENCODED_BYTES);
  });

  it("accepts payloads whose encoded size is within the budget", () => {
    const small = JSON.stringify({ demo: "ok", items: Array.from({ length: 50 }, (_, i) => ({ id: i })) });
    const out = buildViewerUrl({ viewerUrl: "https://argue.onev.cat/", reportJson: small });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error("expected success");
    expect(out.encodedSize).toBeLessThanOrEqual(MAX_ENCODED_BYTES);
    expect(out.url.length).toBeLessThanOrEqual("https://argue.onev.cat/#v=1&d=".length + out.encodedSize);
  });
});

describe("launchBrowser", () => {
  it("spawns `open` on darwin", async () => {
    const spawned: Array<{ cmd: string; args: string[] }> = [];
    await launchBrowser("https://example.com/#v=1&d=abc", {
      platform: "darwin",
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
      }
    });
    expect(spawned).toEqual([{ cmd: "open", args: ["https://example.com/#v=1&d=abc"] }]);
  });

  it("spawns `xdg-open` on linux", async () => {
    const spawned: Array<{ cmd: string; args: string[] }> = [];
    await launchBrowser("https://example.com/#x", {
      platform: "linux",
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
      }
    });
    expect(spawned).toEqual([{ cmd: "xdg-open", args: ["https://example.com/#x"] }]);
  });

  it("spawns `cmd /c start` with an empty title arg on win32", async () => {
    const spawned: Array<{ cmd: string; args: string[] }> = [];
    await launchBrowser("https://example.com/#x", {
      platform: "win32",
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
      }
    });
    expect(spawned).toEqual([{ cmd: "cmd", args: ["/c", "start", "", "https://example.com/#x"] }]);
  });

  it("rejects unknown platforms with a clear error", async () => {
    await expect(launchBrowser("https://example.com/", { platform: "aix", spawn: vi.fn() })).rejects.toThrow(
      /Unsupported platform/
    );
  });
});

describe("openReportInViewer", () => {
  it("opens the browser with a fragment URL built from the given result.json", async () => {
    const runId = "argue_1712000000000_aaaaaa";
    const runDir = join(tmpRoot, runId);
    await mkdir(runDir, { recursive: true });
    const resultPath = join(runDir, "result.json");
    await writeFile(resultPath, JSON.stringify({ hello: "world" }));

    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const outcome = await openReportInViewer({
      resultPath,
      viewerUrl: "https://argue.onev.cat/",
      platform: "darwin",
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
      }
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.url.startsWith("https://argue.onev.cat/#v=1&d=")).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.cmd).toBe("open");
    expect(spawned[0]!.args).toEqual([outcome.url]);
  });

  it("returns { ok: false, reason: 'too-large' } without opening the browser", async () => {
    const runId = "argue_1712000000000_bbbbbb";
    const runDir = join(tmpRoot, runId);
    await mkdir(runDir, { recursive: true });
    const resultPath = join(runDir, "result.json");
    const huge = JSON.stringify({ blob: randomBytes(MAX_ENCODED_BYTES).toString("base64") });
    await writeFile(resultPath, huge);

    const spawned: Array<{ cmd: string; args: string[] }> = [];
    const outcome = await openReportInViewer({
      resultPath,
      viewerUrl: "https://argue.onev.cat/",
      platform: "darwin",
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
      }
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("too-large");
    expect(spawned).toHaveLength(0);
  });

  it("returns { ok: false, reason: 'not-found' } if result.json is missing", async () => {
    const outcome = await openReportInViewer({
      resultPath: join(tmpRoot, "nope", "result.json"),
      viewerUrl: "https://argue.onev.cat/",
      platform: "darwin",
      spawn: () => {}
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("not-found");
  });
});
