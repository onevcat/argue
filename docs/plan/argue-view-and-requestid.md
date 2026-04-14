# `argue view` + Collision-Resistant requestId Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `argue view [id]` so users can open any local run in the hosted viewer with a single command, and fix the same-millisecond requestId collision that makes concurrent runs clobber each other.

**Architecture:** Two bundled changes in a single PR because they share the same ID-matching contract. (1) requestId generator becomes `argue_<ms>_<6 hex>` so concurrent runs never collide. (2) `argue view` reads a local `result.json`, gzip + base64url encodes it into a URL fragment (`#v=1&d=<blob>`), and opens the hosted viewer (default `https://argue.onev.cat/`). The viewer detects the hash on startup, decodes via browser-native `DecompressionStream`, validates, and renders — then strips the hash. `argue run` gains a `--view` flag plus an always-printed `→ View report: argue view <id>` hint. No backend, no local HTTP server, no standalone HTML generation, no viewer bundling into the CLI tarball.

**Tech Stack:** Node `node:crypto` / `node:zlib` / `node:child_process` (no new CLI deps), browser `DecompressionStream` + `atob` (no new viewer deps), `zod` for config schema extension, `vitest` for tests.

---

## File Structure

**New files (CLI):**

- `packages/argue-cli/src/request-id.ts` — `newRequestId()` + `REQUEST_ID_PATTERN`. Single responsibility: ID generation + recognition.
- `packages/argue-cli/src/view.ts` — `openReportInViewer()` orchestrator plus pure helpers: `listCompletedRuns()`, `resolveLatestRequestId()`, `encodeReportForUrl()`, `buildViewerUrl()`, `launchBrowser()`. Everything the `argue view` command and `argue run --view` share.
- `packages/argue-cli/test/request-id.test.ts` — TDD tests for ID generator.
- `packages/argue-cli/test/view.test.ts` — TDD tests for view helpers (encoding, discovery, URL building, browser launch).

**New files (viewer):**

- `packages/argue-viewer/src/lib/decode-hash.ts` — pure async `decodeHashPayload(hash)` → JSON string (or throws). Uses `DecompressionStream`.
- `packages/argue-viewer/test/decode-hash.test.ts` — round-trip tests using Node's `zlib` to build fixtures.

**Modified files (CLI):**

- `packages/argue-cli/src/run-plan.ts:77` — switch default requestId generator.
- `packages/argue-cli/src/config.ts` — add `ViewerConfigSchema`, extend `CliConfigSchemaBase` with `viewer` field, export `DEFAULT_VIEWER_URL`.
- `packages/argue-cli/src/index.ts` — new `view` command, `parseViewOptions`, `--view` flag on `run`, `--viewer-url` support, updated `printHelp`.
- `packages/argue-cli/src/output.ts` — `viewHint()` method printed at the end of `runCompleted`.

**Modified files (viewer):**

- `packages/argue-viewer/src/App.tsx` — startup hash detection path feeding into existing `applyText` + route handling, clearing hash with `replaceState` after success.
- `packages/argue-viewer/test/App.test.tsx` — tests covering hash→report flow, malformed hash, hash cleanup after load.

**Modified files (docs):**

- `README.md` — add `argue view` section.
- `README_CN.md`, `README_JP.md` — mirror the new section.

---

## Task 1: requestId generator module

**Files:**

- Create: `packages/argue-cli/src/request-id.ts`
- Test: `packages/argue-cli/test/request-id.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/argue-cli/test/request-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { newRequestId, REQUEST_ID_PATTERN } from "../src/request-id.js";

describe("newRequestId", () => {
  it("produces a string matching the argue_<ms>_<6hex> shape", () => {
    const id = newRequestId();
    expect(id).toMatch(/^argue_\d+_[a-f0-9]{6}$/);
  });

  it("is unique across 1000 same-tick calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      ids.add(newRequestId());
    }
    expect(ids.size).toBe(1000);
  });

  it("embeds Date.now() in the timestamp segment", () => {
    const before = Date.now();
    const id = newRequestId();
    const after = Date.now();
    const match = /^argue_(\d+)_[a-f0-9]{6}$/.exec(id);
    expect(match).not.toBeNull();
    const ts = Number(match![1]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("REQUEST_ID_PATTERN", () => {
  it("accepts the new format", () => {
    expect(REQUEST_ID_PATTERN.test("argue_1712345678901_a3f9c2")).toBe(true);
  });

  it("accepts legacy ms-only format", () => {
    expect(REQUEST_ID_PATTERN.test("argue_1712345678901")).toBe(true);
  });

  it("rejects strings without argue_ prefix", () => {
    expect(REQUEST_ID_PATTERN.test("run_1712345678901")).toBe(false);
    expect(REQUEST_ID_PATTERN.test("my-custom-id")).toBe(false);
  });

  it("rejects non-hex random suffix", () => {
    expect(REQUEST_ID_PATTERN.test("argue_1712345678901_ZZZZZZ")).toBe(false);
  });

  it("ensures new ids sort after legacy ids with the same timestamp", () => {
    const legacy = "argue_1712345678901";
    const current = "argue_1712345678901_a3f9c2";
    expect([current, legacy].sort()).toEqual([legacy, current]);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- request-id`
Expected: FAIL (module does not exist yet).

- [ ] **Step 3: Implement the module**

Create `packages/argue-cli/src/request-id.ts`:

```ts
import { randomBytes } from "node:crypto";

export const REQUEST_ID_PATTERN = /^argue_\d+(?:_[a-f0-9]+)?$/;

export function newRequestId(): string {
  return `argue_${Date.now()}_${randomBytes(3).toString("hex")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=@onevcat/argue-cli -- request-id`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/request-id.ts packages/argue-cli/test/request-id.test.ts
git commit -m "feat(cli): add collision-resistant requestId generator"
```

---

## Task 2: Wire new generator into `resolveRunPlan`

**Files:**

- Modify: `packages/argue-cli/src/run-plan.ts:77`

- [ ] **Step 1: Check existing test coverage to make sure nothing breaks**

Run: `npm run test --workspace=@onevcat/argue-cli -- run-plan`
Expected: PASS (existing tests use explicit `overrides.requestId`, so they do not depend on the default format).

- [ ] **Step 2: Apply the edit**

In `packages/argue-cli/src/run-plan.ts`, add the import at the top alongside other local imports:

```ts
import { newRequestId } from "./request-id.js";
```

Replace line 77:

```ts
const requestId = overrides.requestId ?? runInput.requestId ?? `argue_${Date.now()}`;
```

with:

```ts
const requestId = overrides.requestId ?? runInput.requestId ?? newRequestId();
```

- [ ] **Step 3: Add a regression test asserting the default format**

Append to `packages/argue-cli/test/run-plan.test.ts` inside the `describe("resolveRunPlan", ...)` block:

```ts
it("generates a collision-resistant default requestId when none is supplied", () => {
  const loadedConfig = makeLoadedConfig();

  const plan = resolveRunPlan({
    loadedConfig,
    runInput: { task: "t" },
    overrides: {}
  });

  expect(plan.requestId).toMatch(/^argue_\d+_[a-f0-9]{6}$/);
});
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=@onevcat/argue-cli -- run-plan`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/run-plan.ts packages/argue-cli/test/run-plan.test.ts
git commit -m "feat(cli): use collision-resistant requestId for new runs"
```

---

## Task 3: Config schema — `viewer.url` + default constant

**Files:**

- Modify: `packages/argue-cli/src/config.ts`
- Modify: `packages/argue-cli/test/config.test.ts` (light additions)

- [ ] **Step 1: Write the failing test**

Append to `packages/argue-cli/test/config.test.ts` (place it near other schema tests; reuse the file's existing imports):

```ts
describe("viewer config", () => {
  it("accepts a viewer.url string in CliConfig", () => {
    const config = CliConfigSchema.parse({
      schemaVersion: 1,
      viewer: { url: "https://viewer.example.com/" },
      providers: {
        mock: { type: "mock", models: { fake: {} } }
      },
      agents: [
        { id: "a1", provider: "mock", model: "fake" },
        { id: "a2", provider: "mock", model: "fake" }
      ]
    });
    expect(config.viewer?.url).toBe("https://viewer.example.com/");
  });

  it("rejects a non-URL string", () => {
    expect(() =>
      CliConfigSchema.parse({
        schemaVersion: 1,
        viewer: { url: "not a url" },
        providers: { mock: { type: "mock", models: { fake: {} } } },
        agents: [
          { id: "a1", provider: "mock", model: "fake" },
          { id: "a2", provider: "mock", model: "fake" }
        ]
      })
    ).toThrow();
  });

  it("allows config without viewer section (optional)", () => {
    const config = CliConfigSchema.parse({
      schemaVersion: 1,
      providers: { mock: { type: "mock", models: { fake: {} } } },
      agents: [
        { id: "a1", provider: "mock", model: "fake" },
        { id: "a2", provider: "mock", model: "fake" }
      ]
    });
    expect(config.viewer).toBeUndefined();
  });
});

describe("DEFAULT_VIEWER_URL", () => {
  it("points at argue.onev.cat by default", () => {
    expect(DEFAULT_VIEWER_URL).toBe("https://argue.onev.cat/");
  });
});
```

Add `DEFAULT_VIEWER_URL` to the imports at the top of `config.test.ts`:

```ts
import { CliConfigSchema, DEFAULT_VIEWER_URL } from "../src/config.js";
```

(If the test file does not already import `CliConfigSchema`, add it alongside existing imports — check the file before editing.)

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- config`
Expected: FAIL (`DEFAULT_VIEWER_URL` undefined, `viewer` key rejected by strict schema).

- [ ] **Step 3: Extend the schema**

In `packages/argue-cli/src/config.ts`, add near the other schema constants (before `CliConfigSchemaBase`):

```ts
export const DEFAULT_VIEWER_URL = "https://argue.onev.cat/";

export const ViewerConfigSchema = z
  .object({
    url: z.string().url()
  })
  .strict();
```

Then in the existing `CliConfigSchemaBase` object, add `viewer: ViewerConfigSchema.optional(),` to the shape (alongside `output`, `defaults`):

```ts
const CliConfigSchemaBase = z
  .object({
    schemaVersion: z.literal(1),
    output: OutputSchema.optional(),
    viewer: ViewerConfigSchema.optional(),
    defaults: DefaultsSchema.optional(),
    providers: z.record(ProviderSchema).refine((providers) => Object.keys(providers).length > 0, {
      message: "config.providers must contain at least one provider"
    }),
    agents: z.array(AgentSchema).min(2)
  })
  .strict();
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=@onevcat/argue-cli -- config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/config.ts packages/argue-cli/test/config.test.ts
git commit -m "feat(cli): add viewer.url config field with argue.onev.cat default"
```

---

## Task 4: View helpers — run discovery

**Files:**

- Create: `packages/argue-cli/src/view.ts` (first slice: discovery only)
- Test: `packages/argue-cli/test/view.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/argue-cli/test/view.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCompletedRuns, resolveLatestRequestId } from "../src/view.js";

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
    await makeRun("argue_1711000000000_zzzzzz");
    await makeRun("argue_1712000000000_bbbbbb");
    const resultTemplate = join(tmpRoot, "{requestId}", "result.json");
    const runs = await listCompletedRuns(resultTemplate);
    expect(runs.map((r) => r.requestId)).toEqual([
      "argue_1711000000000_zzzzzz",
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
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: FAIL (view.ts does not exist).

- [ ] **Step 3: Implement discovery helpers**

Create `packages/argue-cli/src/view.ts`:

```ts
import { access, readdir } from "node:fs/promises";
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
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/view.ts packages/argue-cli/test/view.test.ts
git commit -m "feat(cli): add run discovery helpers for argue view"
```

---

## Task 5: View helpers — URL encoding pipeline

**Files:**

- Modify: `packages/argue-cli/src/view.ts`
- Modify: `packages/argue-cli/test/view.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/argue-cli/test/view.test.ts`:

```ts
import { gunzipSync } from "node:zlib";
import { buildViewerUrl, encodeReportForUrl, MAX_ENCODED_BYTES } from "../src/view.js";

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
    // Same host, same fragment, same shape — trailing slash harmonized.
    expect(a.url.replace(/#.*$/, "")).toBe(b.url.replace(/#.*$/, ""));
  });

  it("refuses payloads whose encoded size exceeds MAX_ENCODED_BYTES", () => {
    // Build an incompressible payload > MAX_ENCODED_BYTES by filling random-ish bytes.
    const big = JSON.stringify({ blob: Array.from({ length: MAX_ENCODED_BYTES + 1 }, (_, i) => i).join("-") });
    const out = buildViewerUrl({ viewerUrl: "https://argue.onev.cat/", reportJson: big });
    // Either the payload compresses small enough to fit (rare), or we get a too-large reason.
    if (!out.ok) {
      expect(out.reason).toBe("too-large");
      expect(out.encodedSize).toBeGreaterThan(0);
    } else {
      // If it did fit, assert the invariant: we did not silently exceed.
      expect(out.url.length).toBeLessThanOrEqual("https://argue.onev.cat/#v=1&d=".length + MAX_ENCODED_BYTES);
    }
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: FAIL (`encodeReportForUrl` / `buildViewerUrl` / `MAX_ENCODED_BYTES` not exported).

- [ ] **Step 3: Implement encoding + URL building**

Add to `packages/argue-cli/src/view.ts` (at the top, after existing imports):

```ts
import { gzipSync } from "node:zlib";
```

Then append the new exports (below the discovery helpers, before the `void` block — also delete the `void dirname; void join;` block since `join` is now unused and `dirname` is unused; trim imports accordingly):

```ts
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
```

Leave the rest of the file unchanged.

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/view.ts packages/argue-cli/test/view.test.ts
git commit -m "feat(cli): encode result.json to URL fragment via gzip+base64url"
```

---

## Task 6: View helpers — cross-platform browser launcher

**Files:**

- Modify: `packages/argue-cli/src/view.ts`
- Modify: `packages/argue-cli/test/view.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/argue-cli/test/view.test.ts`:

```ts
import { vi } from "vitest";

describe("launchBrowser", () => {
  it("spawns `open` on darwin", async () => {
    const { launchBrowser } = await import("../src/view.js");
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
    const { launchBrowser } = await import("../src/view.js");
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
    const { launchBrowser } = await import("../src/view.js");
    const spawned: Array<{ cmd: string; args: string[] }> = [];
    await launchBrowser("https://example.com/#x", {
      platform: "win32",
      spawn: (cmd, args) => {
        spawned.push({ cmd, args });
      }
    });
    // `start` requires an empty first quoted arg as window title placeholder.
    expect(spawned).toEqual([{ cmd: "cmd", args: ["/c", "start", "", "https://example.com/#x"] }]);
  });

  it("rejects unknown platforms with a clear error", async () => {
    const { launchBrowser } = await import("../src/view.js");
    await expect(launchBrowser("https://example.com/", { platform: "aix", spawn: vi.fn() })).rejects.toThrow(
      /Unsupported platform/
    );
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: FAIL (`launchBrowser` not exported).

- [ ] **Step 3: Implement the launcher**

Add to `packages/argue-cli/src/view.ts`:

```ts
import { spawn as nodeSpawn } from "node:child_process";

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
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/view.ts packages/argue-cli/test/view.test.ts
git commit -m "feat(cli): add cross-platform browser launcher for argue view"
```

---

## Task 7: View orchestrator — `openReportInViewer`

**Files:**

- Modify: `packages/argue-cli/src/view.ts`
- Modify: `packages/argue-cli/test/view.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/argue-cli/test/view.test.ts`:

```ts
import { writeFile as writeFileAsync } from "node:fs/promises";

describe("openReportInViewer", () => {
  it("opens the browser with a fragment URL built from the given result.json", async () => {
    const { openReportInViewer } = await import("../src/view.js");
    const runId = "argue_1712000000000_aaaaaa";
    const runDir = join(tmpRoot, runId);
    await mkdir(runDir, { recursive: true });
    const resultPath = join(runDir, "result.json");
    await writeFileAsync(resultPath, JSON.stringify({ hello: "world" }));

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
    const { openReportInViewer, MAX_ENCODED_BYTES } = await import("../src/view.js");
    const runId = "argue_1712000000000_bbbbbb";
    const runDir = join(tmpRoot, runId);
    await mkdir(runDir, { recursive: true });
    const resultPath = join(runDir, "result.json");
    // Incompressible-ish payload guaranteed to exceed budget after gzip.
    const huge = JSON.stringify({
      data: Array.from({ length: MAX_ENCODED_BYTES * 3 }, (_, i) => i.toString(16)).join("")
    });
    await writeFileAsync(resultPath, huge);

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
    const { openReportInViewer } = await import("../src/view.js");
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
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: FAIL (`openReportInViewer` not exported).

- [ ] **Step 3: Implement the orchestrator**

Add to `packages/argue-cli/src/view.ts`. First extend the existing `node:fs/promises` import so it reads `import { access, readdir, readFile } from "node:fs/promises";`, then append:

```ts
export type OpenReportInViewerOptions = {
  resultPath: string;
  viewerUrl: string;
  platform?: NodeJS.Platform | string;
  spawn?: BrowserSpawnFn;
};

export type OpenReportInViewerResult =
  | { ok: true; url: string; encodedSize: number }
  | { ok: false; reason: "not-found"; resultPath: string }
  | { ok: false; reason: "too-large"; encodedSize: number; resultPath: string };

export async function openReportInViewer(options: OpenReportInViewerOptions): Promise<OpenReportInViewerResult> {
  let json: string;
  try {
    json = await readFile(options.resultPath, "utf8");
  } catch {
    return { ok: false, reason: "not-found", resultPath: options.resultPath };
  }

  const built = buildViewerUrl({ viewerUrl: options.viewerUrl, reportJson: json });
  if (!built.ok) {
    return { ok: false, reason: "too-large", encodedSize: built.encodedSize, resultPath: options.resultPath };
  }

  await launchBrowser(built.url, { platform: options.platform, spawn: options.spawn });
  return { ok: true, url: built.url, encodedSize: built.encodedSize };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/view.ts packages/argue-cli/test/view.test.ts
git commit -m "feat(cli): add openReportInViewer orchestrator"
```

---

## Task 8: Expose `argue view` command

**Files:**

- Modify: `packages/argue-cli/src/index.ts`
- Test: reuse existing integration-style tests; add one integration test in `packages/argue-cli/test/view.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append to `packages/argue-cli/test/view.test.ts`:

```ts
import { runCli } from "../src/index.js";
import { writeFile as writeFileAsyncAgain } from "node:fs/promises";

describe("runCli view command", () => {
  function captureIo() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: {
        log: (msg: string) => out.push(String(msg)),
        error: (msg: string) => err.push(String(msg))
      },
      out,
      err
    };
  }

  it("rejects the command when there is no completed run to open", async () => {
    // Pointing at an empty tmp dir via --result path to force the discovery miss.
    const missingResult = join(tmpRoot, "argue_1712000000000_deadbe", "result.json");
    const { io, err } = captureIo();
    const result = await runCli(["view", "--result", missingResult, "--viewer-url", "https://argue.onev.cat/"], io);
    expect(result.ok).toBe(false);
    expect(err.join("\n")).toMatch(/No result\.json/);
  });

  it("resolves the result path from --result and calls the orchestrator", async () => {
    const runId = "argue_1712000000000_a1b2c3";
    const runDir = join(tmpRoot, runId);
    await mkdir(runDir, { recursive: true });
    const resultPath = join(runDir, "result.json");
    await writeFileAsyncAgain(resultPath, JSON.stringify({ demo: true }));

    const { io, out } = captureIo();
    const result = await runCli(
      [
        "view",
        "--result",
        resultPath,
        "--viewer-url",
        "https://argue.onev.cat/",
        "--no-open" // test-only flag that skips launchBrowser
      ],
      io
    );
    expect(result.ok).toBe(true);
    expect(out.join("\n")).toMatch(/https:\/\/argue\.onev\.cat\/#v=1&d=/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: FAIL (`view` command unknown).

- [ ] **Step 3: Wire the command in `index.ts`**

In `packages/argue-cli/src/index.ts`, add the import near the existing imports:

```ts
import { openReportInViewer, resolveLatestRequestId } from "./view.js";
import { DEFAULT_VIEWER_URL } from "./config.js";
```

Add dispatch in `runCli` next to the existing `run`/`config`/`act` branches (before the unknown-command fallthrough):

```ts
if (command === "view") {
  return runView(rest, io);
}
```

Add the new command handler (place it right after `runAction`):

```ts
async function runView(args: string[], io: Pick<typeof console, "log" | "error">): Promise<CliResult> {
  const options = parseViewOptions(args);
  if (!options.ok) {
    io.error(options.error);
    return { ok: false, code: 1 };
  }

  let resultPath = options.value.resultPath;

  if (!resultPath) {
    // No explicit result path → resolve from config + optional requestId.
    let loadedConfig;
    try {
      loadedConfig = await loadCliConfig({ explicitPath: options.value.configPath });
    } catch (error) {
      io.error(String(error));
      return { ok: false, code: 1 };
    }

    // Rebuild the same resultPath template that resolveRunPlan uses, then
    // either substitute the explicit requestId or discover the latest.
    const template = resolveResultPathTemplate(loadedConfig);
    if (options.value.requestId) {
      resultPath = template.replaceAll("{requestId}", options.value.requestId);
    } else {
      const latest = await resolveLatestRequestId(template);
      if (!latest) {
        io.error(
          [
            "No completed argue runs found.",
            `Scanned template: ${template}`,
            "Run `argue run ...` first, or pass --request-id <id> / --result <path>."
          ].join("\n")
        );
        return { ok: false, code: 1 };
      }
      resultPath = latest.resultPath;
    }
  }

  const viewerUrl = options.value.viewerUrl ?? (await resolveConfiguredViewerUrl(options.value.configPath));

  const outcome = await openReportInViewer({
    resultPath,
    viewerUrl,
    ...(options.value.noOpen ? { spawn: () => {} } : {})
  });

  if (!outcome.ok) {
    if (outcome.reason === "not-found") {
      io.error(`No result.json at: ${outcome.resultPath}`);
      return { ok: false, code: 1 };
    }
    // too-large — fall back to printing a helpful message.
    io.error(
      [
        `Report too large to embed in a URL (encoded: ${outcome.encodedSize} bytes, limit: 200000).`,
        `Open ${viewerUrl} manually and drag this file in:`,
        `  ${outcome.resultPath}`
      ].join("\n")
    );
    return { ok: false, code: 1 };
  }

  io.log(`→ Opening report: ${outcome.url}`);
  return { ok: true, code: 0 };
}

type ViewOptions = {
  configPath?: string;
  requestId?: string;
  resultPath?: string;
  viewerUrl?: string;
  noOpen?: boolean;
};

function parseViewOptions(args: string[]): { ok: true; value: ViewOptions } | { ok: false; error: string } {
  const out: ViewOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--config" || arg === "-c") {
      const value = args[++i];
      if (!value) return { ok: false, error: "Missing value for --config" };
      out.configPath = value;
      continue;
    }
    if (arg === "--request-id") {
      const value = args[++i];
      if (!value) return { ok: false, error: "Missing value for --request-id" };
      out.requestId = value;
      continue;
    }
    if (arg === "--result") {
      const value = args[++i];
      if (!value) return { ok: false, error: "Missing value for --result" };
      out.resultPath = value;
      continue;
    }
    if (arg === "--viewer-url") {
      const value = args[++i];
      if (!value) return { ok: false, error: "Missing value for --viewer-url" };
      out.viewerUrl = value;
      continue;
    }
    if (arg === "--no-open") {
      out.noOpen = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return { ok: false, error: `Unknown flag for argue view: ${arg}` };
    }
    // Positional → interpret as requestId (argue view <id>).
    if (!out.requestId) {
      out.requestId = arg;
      continue;
    }
    return { ok: false, error: `Unexpected argument: ${arg}` };
  }
  return { ok: true, value: out };
}

function resolveResultPathTemplate(loadedConfig: LoadedCliConfig): string {
  // Mirror the logic in resolveRunPlan — local vs global default, with override.
  const globalConfigDir = join(homedir(), ".config", "argue");
  const isGlobalConfig = loadedConfig.configDir === globalConfigDir;
  const defaultOutputDir = isGlobalConfig ? join(homedir(), ".argue", "output", "{requestId}") : "./out/{requestId}";
  const raw = loadedConfig.config.output?.resultPath ?? `${defaultOutputDir}/result.json`;
  // Substitute base dir but keep {requestId} token intact.
  return resolveOutputPath(raw, loadedConfig.configDir, "{requestId}");
}

async function resolveConfiguredViewerUrl(explicitConfigPath?: string): Promise<string> {
  try {
    const loadedConfig = await loadCliConfig({ explicitPath: explicitConfigPath });
    return loadedConfig.config.viewer?.url ?? DEFAULT_VIEWER_URL;
  } catch {
    return DEFAULT_VIEWER_URL;
  }
}
```

Add the extra imports this handler depends on at the top of the file:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCliConfig, type LoadedCliConfig, resolveOutputPath } from "./config.js";
```

(If `loadCliConfig` / `resolveOutputPath` are already imported above, extend the existing import list instead of duplicating it.)

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=@onevcat/argue-cli -- view`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/argue-cli/src/index.ts packages/argue-cli/test/view.test.ts
git commit -m "feat(cli): add argue view command"
```

---

## Task 9: `argue run --view` flag + completion hint

**Files:**

- Modify: `packages/argue-cli/src/index.ts`
- Modify: `packages/argue-cli/src/output.ts`
- Modify: `packages/argue-cli/test/output.test.ts`
- Modify: `packages/argue-cli/test/headless-run.test.ts` (if existing headless test asserts on stdout; otherwise add to `packages/argue-cli/test/output.test.ts`)

- [ ] **Step 1: Write the failing output test**

Append to `packages/argue-cli/test/output.test.ts` (reuse the file's existing imports and helpers — locate the existing `runCompleted` test block for the style):

```ts
describe("view hint", () => {
  it("prints `→ View report: argue view <id>` after runCompleted", () => {
    const logs: string[] = [];
    const io = { log: (s: string) => logs.push(String(s)), error: () => {} };
    const formatter = createOutputFormatter(io, { isTTY: false, noColor: true });
    formatter.viewHint("argue_1712000000000_aaaaaa");
    expect(logs.join("\n")).toContain("→ View report: argue view argue_1712000000000_aaaaaa");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-cli -- output`
Expected: FAIL (`viewHint` not defined on the formatter).

- [ ] **Step 3: Add `viewHint` to the formatter**

In `packages/argue-cli/src/output.ts`, inside the object returned by `createOutputFormatter`, add near `runCompleted`:

```ts
viewHint(requestId: string) {
  io.log(c.dim(`→ View report: argue view ${requestId}`));
},
```

- [ ] **Step 4: Run output test**

Run: `npm run test --workspace=@onevcat/argue-cli -- output`
Expected: PASS.

- [ ] **Step 5: Wire `--view` flag in `parseRunOptions`**

In `packages/argue-cli/src/index.ts`:

1. Extend `CliRunOptions` with:

```ts
view?: boolean;
viewerUrl?: string;
```

2. In `parseRunOptions` (around the other boolean flags), add:

```ts
if (arg === "--view") {
  out.view = true;
  continue;
}
if (arg === "--viewer-url") {
  const value = args[++i];
  if (!value) return { ok: false, error: "Missing value for --viewer-url" };
  out.viewerUrl = value;
  continue;
}
```

3. In `runHeadless`, after the successful `runCompleted(...)` call and before `return { ok: true, code: 0 };`, add:

```ts
out.viewHint(plan.requestId);

if (options.value.view) {
  const viewerUrl = options.value.viewerUrl ?? loadedConfig.config.viewer?.url ?? DEFAULT_VIEWER_URL;
  const outcome = await openReportInViewer({
    resultPath: execution.resultPath,
    viewerUrl
  });
  if (!outcome.ok) {
    if (outcome.reason === "not-found") {
      io.error(`No result.json at: ${outcome.resultPath}`);
    } else {
      io.error(
        [
          `Report too large to embed in a URL (encoded: ${outcome.encodedSize} bytes, limit: 200000).`,
          `Open ${viewerUrl} manually and drag this file in:`,
          `  ${outcome.resultPath}`
        ].join("\n")
      );
    }
    // Don't fail the run — the debate succeeded. Just surface the error.
  } else {
    io.log(`→ Opening report: ${outcome.url}`);
  }
}
```

(`DEFAULT_VIEWER_URL` and `openReportInViewer` are already imported from Task 8.)

- [ ] **Step 6: Run full CLI tests**

Run: `npm run test --workspace=@onevcat/argue-cli`
Expected: PASS (no regressions; view hint + flag path exercised via unit tests).

- [ ] **Step 7: Commit**

```bash
git add packages/argue-cli/src/index.ts packages/argue-cli/src/output.ts packages/argue-cli/test/output.test.ts
git commit -m "feat(cli): add --view flag and completion hint to argue run"
```

---

## Task 10: Viewer — hash decoder module

**Files:**

- Create: `packages/argue-viewer/src/lib/decode-hash.ts`
- Test: `packages/argue-viewer/test/decode-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/argue-viewer/test/decode-hash.test.ts`:

```ts
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeHashPayload } from "../src/lib/decode-hash.js";

function encodeForHash(payload: string): string {
  const gz = gzipSync(Buffer.from(payload, "utf8"));
  return gz.toString("base64url");
}

describe("decodeHashPayload", () => {
  it("returns null for an empty hash", async () => {
    expect(await decodeHashPayload("")).toBeNull();
    expect(await decodeHashPayload("#")).toBeNull();
  });

  it("decodes a v=1 gzip+base64url payload back to the original JSON string", async () => {
    const json = JSON.stringify({ hello: "world", n: 42 });
    const hash = `#v=1&d=${encodeForHash(json)}`;
    const decoded = await decodeHashPayload(hash);
    expect(decoded).toBe(json);
  });

  it("rejects an unsupported version", async () => {
    const json = JSON.stringify({ hello: "world" });
    const hash = `#v=2&d=${encodeForHash(json)}`;
    await expect(decodeHashPayload(hash)).rejects.toThrow(/Unsupported/);
  });

  it("rejects a missing data segment", async () => {
    await expect(decodeHashPayload("#v=1")).rejects.toThrow(/Missing/);
  });

  it("rejects garbage base64url", async () => {
    await expect(decodeHashPayload("#v=1&d=@@@@not base64@@@@")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-viewer -- decode-hash`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the decoder**

Create `packages/argue-viewer/src/lib/decode-hash.ts`:

```ts
/**
 * Returns the original JSON string carried in the hash, or null if the hash
 * is empty. Throws with a descriptive message for unsupported versions,
 * missing fields, or decoding failures.
 *
 * Expected hash shape: `#v=1&d=<gzip-then-base64url encoded JSON>`.
 */
export async function decodeHashPayload(hash: string): Promise<string | null> {
  if (!hash || hash === "#") return null;
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  if (!params.has("v") && !params.has("d")) return null;

  const version = params.get("v");
  if (version !== "1") {
    throw new Error(`Unsupported report hash version: ${version ?? "<missing>"}`);
  }
  const data = params.get("d");
  if (!data) {
    throw new Error("Missing data (`d=`) in report hash.");
  }

  const bytes = base64UrlToBytes(data);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
```

- [ ] **Step 4: Run test**

Run: `npm run test --workspace=@onevcat/argue-viewer -- decode-hash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/argue-viewer/src/lib/decode-hash.ts packages/argue-viewer/test/decode-hash.test.ts
git commit -m "feat(viewer): decode argue result from URL fragment"
```

---

## Task 11: Viewer — App.tsx hash startup detection

**Files:**

- Modify: `packages/argue-viewer/src/App.tsx`
- Modify: `packages/argue-viewer/test/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/argue-viewer/test/App.test.tsx`:

```ts
import { gzipSync } from "node:zlib";

function encodeFixtureForHash(): string {
  const gz = gzipSync(Buffer.from(JSON.stringify(createFixtureResult()), "utf8"));
  return gz.toString("base64url");
}

describe("App hash payload", () => {
  it("loads a report from the #v=1&d= fragment and clears the hash after render", async () => {
    window.history.replaceState(null, "", `/#v=1&d=${encodeFixtureForHash()}`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });
    expect(window.location.pathname).toBe("/report");
    expect(window.location.hash).toBe("");
  });

  it("surfaces a friendly error for malformed hash payloads", async () => {
    window.history.replaceState(null, "", "/#v=1&d=@@@not-base64@@@");
    render(<App />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/report hash|decode/i);
    });
    expect(window.location.hash).toBe("");
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm run test --workspace=@onevcat/argue-viewer -- App`
Expected: FAIL (hash branch not implemented).

- [ ] **Step 3: Wire hash handling in App.tsx**

At the top of `packages/argue-viewer/src/App.tsx`, add the import:

```ts
import { decodeHashPayload } from "./lib/decode-hash.js";
```

Inside `useEffect` at the bottom of the component (currently calling `syncFromPath()`), replace the body so that a hash takes priority over path-only routing:

```ts
useEffect(() => {
  const consumeHash = async (): Promise<boolean> => {
    try {
      const decoded = await decodeHashPayload(window.location.hash);
      if (!decoded) return false;
      pushRoute("report");
      const result = applyText(decoded, "hash");
      if (result) {
        reportCacheRef.current = { source: "hash", result };
      }
      // Strip the hash — it was a one-shot delivery mechanism, not a persistent route.
      const cleanPath = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", cleanPath || "/");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to decode report hash.";
      setState({ kind: "error", source: "hash", error: message });
      const cleanPath = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", cleanPath || "/");
      return true;
    }
  };

  const syncFromPath = () => {
    const route = routeFromPath(window.location.pathname);
    if (route === "home") {
      setState({ kind: "idle" });
      return;
    }
    if (route === "example") {
      void showExample(false);
      return;
    }
    // route === "report"
    const cached = reportCacheRef.current;
    if (cached) {
      setState({ kind: "loaded", source: cached.source, result: cached.result });
      return;
    }
    replaceRoute("home");
    setState({ kind: "idle" });
  };

  void (async () => {
    const consumed = await consumeHash();
    if (!consumed) syncFromPath();
  })();

  const onPopState = () => {
    void (async () => {
      const consumed = await consumeHash();
      if (!consumed) syncFromPath();
    })();
  };
  window.addEventListener("popstate", onPopState);
  return () => {
    window.removeEventListener("popstate", onPopState);
  };
}, []);
```

- [ ] **Step 4: Run test**

Run: `npm run test --workspace=@onevcat/argue-viewer -- App`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/argue-viewer/src/App.tsx packages/argue-viewer/test/App.test.tsx
git commit -m "feat(viewer): auto-load report from URL fragment on startup"
```

---

## Task 12: Help text + README updates

**Files:**

- Modify: `packages/argue-cli/src/index.ts` (`printHelp`)
- Modify: `README.md`
- Modify: `README_CN.md`, `README_JP.md`

- [ ] **Step 1: Extend `printHelp` with `argue view`**

In `packages/argue-cli/src/index.ts`, inside `printHelp`, add lines in the Usage block:

```ts
io.log("  argue view [request-id] [options]   # open a completed run in the hosted viewer");
```

And a new section before "Config commands:":

```ts
io.log("");
io.log("View options:");
io.log("  --config <path>                 config JSON path");
io.log("  --request-id <id>               specific run id (overrides default-latest)");
io.log("  --result <path>                 path to a result.json (overrides discovery)");
io.log("  --viewer-url <url>              override viewer URL (default: https://argue.onev.cat/)");
io.log("");
io.log("Headless `--view`:");
io.log("  --view                          open the report in the hosted viewer on completion");
```

Also extend the Headless options block with the `--view` / `--viewer-url` lines near the other output flags.

- [ ] **Step 2: Update README.md**

Add a new section under "Run a Debate" → "What Happens" (or wherever the output section sits):

```markdown
### View the Report

After every run, argue prints a hint:

\`\`\`
→ View report: argue view argue_1712345678901_a3f9c2
\`\`\`

Run that command to open the report in the hosted viewer (default: https://argue.onev.cat/). You can also:

\`\`\`bash
argue view # open the most recent run
argue view <request-id> # open a specific run
argue run --view # open automatically after a run completes
\`\`\`

The report is encoded into a URL fragment and decoded in the browser — nothing is uploaded. To override the viewer location, set `viewer.url` in your config or pass `--viewer-url`.
```

(Backticks inside the markdown block need escaping in this plan; inside README.md they are plain code fences.)

Mirror the same section into `README_CN.md` (中文) and `README_JP.md` (日本語) — translate preserving code blocks.

- [ ] **Step 3: Run format + lint**

Run:

```bash
npm run format
npm run lint
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/argue-cli/src/index.ts README.md README_CN.md README_JP.md
git commit -m "docs: document argue view command"
```

---

## Task 13: Full repo CI gate

- [ ] **Step 1: Run full pipeline**

Run:

```bash
npm run format:check
npm run lint
npm run ci
```

Expected: all pass.

- [ ] **Step 2: Run packaging smoke tests**

Run:

```bash
npm run smoke:pack
```

Expected: both `@onevcat/argue` and `@onevcat/argue-cli` tarballs install + execute `argue --version` cleanly.

- [ ] **Step 3: Manual browser sanity check**

Start viewer dev server and verify the hash flow manually:

```bash
npm run dev:viewer &
DEV_PID=$!
# In another terminal or after a few seconds:
node packages/argue-cli/dist/cli.js run --input packages/argue-cli/examples/task.example.json --view --viewer-url http://localhost:5173/
kill $DEV_PID
```

Expected: browser opens at `http://localhost:5173/#v=1&d=...`, report renders, hash is cleaned to `/report`.

- [ ] **Step 4: Commit (if any formatting/lint fixups were required)**

```bash
git status
# If there are residual changes:
git add -A
git commit -m "chore: final ci fixups for argue view"
```

---

## Self-Review Checklist

Before handing this plan off:

1. **Spec coverage:**
   - [x] `argue view` with optional positional id — Task 8
   - [x] `argue view` with `--result` override — Task 8
   - [x] `argue view --viewer-url` override — Tasks 8 + 9
   - [x] Config `viewer.url` field with default — Task 3
   - [x] `argue run --view` flag — Task 9
   - [x] Always-printed completion hint — Task 9
   - [x] Oversized fallback — Tasks 7 + 8
   - [x] Viewer hash decoding via `DecompressionStream` — Task 10
   - [x] Viewer startup hash detection + clean-up — Task 11
   - [x] requestId format upgrade — Tasks 1 + 2
   - [x] Filename-based run discovery — Task 4
   - [x] Cross-platform browser launch — Task 6
   - [x] Docs — Task 12
   - [x] CI gate — Task 13

2. **No placeholders:** every step either shows concrete code or gives an exact command with expected output.

3. **Type consistency:**
   - `CompletedRun` shape (Task 4) — used in Tasks 7 + 8 via `resolveLatestRequestId`.
   - `BuildViewerUrlResult` discriminated union — matches what `openReportInViewer` maps onto `OpenReportInViewerResult` (Task 7).
   - `LaunchBrowserOptions.spawn` signature — same `BrowserSpawnFn` used in Task 6 test and Task 7 integration test.
   - `viewHint(requestId)` — defined Task 9 Step 3, called Task 9 Step 5.

4. **Scope:** two bundled changes share the `REQUEST_ID_PATTERN` contract. They must land together — discovery depends on the new pattern, and the new pattern must be in place before any real user hits `argue view`. Single PR is correct.

---

## Execution Options

Plan complete and committed. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — walk the tasks in this session with checkpoints.

Which approach?
