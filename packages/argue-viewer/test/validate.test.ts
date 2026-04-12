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

  it("rejects unsupported result version", () => {
    const valid = createFixtureResult();
    const invalid = { ...valid, resultVersion: ARGUE_RESULT_VERSION + 1 };

    const result = validateArgueResult(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported resultVersion");
    }
  });

  it("rejects schema mismatch with path", () => {
    const valid = createFixtureResult();
    const invalid = { ...valid, requestId: "" };

    const result = validateArgueResult(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("requestId");
    }
  });
});
