import { describe, expect, it } from "vitest";
import { ARGUE_VERSION } from "../src/index.js";

describe("argue scaffold", () => {
  it("exports version", () => {
    expect(ARGUE_VERSION).toBe("0.1.0");
  });
});
