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
