import { describe, expect, it } from "vitest";
import { ArgueEngine } from "../src/index.js";

describe("argue scaffold", () => {
  it("exports engine", () => {
    expect(typeof ArgueEngine).toBe("function");
  });
});
