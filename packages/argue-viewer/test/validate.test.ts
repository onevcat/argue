import { ARGUE_RESULT_VERSION } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import { validateArgueResult } from "../src/lib/validate.js";
import { createFixtureResult } from "./fixtures.js";

describe("validateArgueResult", () => {
  it("accepts a valid result", () => {
    const valid = createFixtureResult();
    const result = validateArgueResult(valid);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.requestId).toBe("req-1");
    }
  });

  it("rejects null input", () => {
    const result = validateArgueResult(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("must be a JSON object");
    }
  });

  it("rejects array input", () => {
    const result = validateArgueResult([]);
    // arrays are objects; they get through the initial guard but fail schema parse.
    expect(result.ok).toBe(false);
  });

  it("rejects primitive input", () => {
    expect(validateArgueResult("hello").ok).toBe(false);
    expect(validateArgueResult(42).ok).toBe(false);
    expect(validateArgueResult(undefined).ok).toBe(false);
  });

  it("treats a missing resultVersion field as version 1", () => {
    const valid = createFixtureResult();
    const { resultVersion: _removed, ...rest } = valid;
    void _removed;

    const result = validateArgueResult(rest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.resultVersion).toBe(ARGUE_RESULT_VERSION);
      expect(result.data.requestId).toBe("req-1");
    }
  });

  it("rejects an explicit unsupported resultVersion", () => {
    const valid = createFixtureResult();
    const invalid = { ...valid, resultVersion: ARGUE_RESULT_VERSION + 1 };

    const result = validateArgueResult(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported resultVersion");
      expect(result.error).toContain(`expected ${ARGUE_RESULT_VERSION}`);
    }
  });

  it("rejects an explicit null resultVersion as unsupported", () => {
    const valid = createFixtureResult();
    // Explicit null is different from missing: the caller tried to set it.
    const invalid = { ...valid, resultVersion: null };

    const result = validateArgueResult(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported resultVersion");
    }
  });

  it("rejects schema mismatch with top-level path", () => {
    const valid = createFixtureResult();
    const invalid = { ...valid, requestId: "" };

    const result = validateArgueResult(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("requestId");
    }
  });

  it("renders deep paths with bracket index notation", () => {
    const valid = createFixtureResult();
    // break the first round's first output to trigger a deep path.
    const invalid = structuredClone(valid) as typeof valid & { rounds: typeof valid.rounds };
    // @ts-expect-error — intentional break for test
    invalid.rounds[0].outputs[0].summary = "";

    const result = validateArgueResult(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // every `.[N]` should be collapsed to `[N]` — no `.[` must remain.
      expect(result.error).not.toContain(".[");
      expect(result.error).toMatch(/rounds\[0\]\.outputs\[0\]/);
    }
  });

  it("reports multi-issue count when more than one problem exists", () => {
    const valid = createFixtureResult();
    const invalid = { ...valid, requestId: "", sessionId: "" };

    const result = validateArgueResult(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/and \d+ more issue/);
    }
  });
});
