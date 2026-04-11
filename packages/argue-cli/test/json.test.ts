import { describe, expect, it } from "vitest";
import { extractJsonObject, parseJsonObject, repairJsonText, stripCodeFences } from "../src/runtime/json.js";

describe("runtime/json", () => {
  it("strips fenced json content", () => {
    const text = '```json\n{"a":1}\n```';
    expect(stripCodeFences(text)).toBe('{"a":1}');
  });

  it("extracts first complete json object from noisy text", () => {
    const text = ["preface", '{"a":1,"nested":{"msg":"hello } world"}}', "suffix"].join("\n");

    expect(extractJsonObject(text)).toBe('{"a":1,"nested":{"msg":"hello } world"}}');
  });

  it("parseJsonObject throws when no json object exists", () => {
    expect(() => parseJsonObject("no json here")).toThrow(/No JSON object found/);
  });

  it("repairJsonText reuses extractor behavior", () => {
    expect(repairJsonText('```\n{"ok":true}\n```')).toBe('{"ok":true}');
  });
});
