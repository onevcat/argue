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

  it("rejects hex suffixes of wrong length", () => {
    expect(REQUEST_ID_PATTERN.test("argue_1712345678901_a")).toBe(false);
    expect(REQUEST_ID_PATTERN.test("argue_1712345678901_abcdef01")).toBe(false);
  });

  it("ensures new ids sort after legacy ids with the same timestamp", () => {
    const legacy = "argue_1712345678901";
    const current = "argue_1712345678901_a3f9c2";
    expect([current, legacy].sort()).toEqual([legacy, current]);
  });
});
