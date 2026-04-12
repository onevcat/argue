import { describe, expect, it } from "vitest";
import {
  extractJsonObject,
  JsonParseError,
  parseJsonObject,
  repairJsonText,
  stripCodeFences,
  tryRepairJson
} from "../src/runtime/json.js";

describe("runtime/json", () => {
  it("strips fenced json content", () => {
    const text = '```json\n{"a":1}\n```';
    expect(stripCodeFences(text)).toBe('{"a":1}');
  });

  it("extracts first complete json object from noisy text", () => {
    const text = ["preface", '{"a":1,"nested":{"msg":"hello } world"}}', "suffix"].join("\n");

    expect(extractJsonObject(text)).toBe('{"a":1,"nested":{"msg":"hello } world"}}');
  });

  it("parseJsonObject throws JsonParseError with rawText when no json object exists", () => {
    const text = "no json here";
    try {
      parseJsonObject(text);
      expect.fail("expected parseJsonObject to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonParseError);
      const parseError = error as JsonParseError;
      expect(parseError.message).toMatch(/No JSON object found/);
      expect(parseError.rawText).toBe(text);
      expect(parseError.extractedCandidate).toBeNull();
    }
  });

  it("parseJsonObject throws JsonParseError with rawText and extractedCandidate on malformed JSON", () => {
    // Bogus identifier tokens inside a brace-balanced blob: extractor
    // returns the slice, strict parse fails with "Unexpected token",
    // and the lenient repair path cannot invent valid content.
    const text = "{bogus literal nonsense}";
    try {
      parseJsonObject(text);
      expect.fail("expected parseJsonObject to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(JsonParseError);
      const parseError = error as JsonParseError;
      expect(parseError.rawText).toBe(text);
      expect(parseError.extractedCandidate).toBe(text);
      expect(parseError.message).toMatch(/Invalid JSON output/);
      // The underlying SyntaxError should be preserved as the cause.
      expect(parseError.cause).toBeInstanceOf(SyntaxError);
    }
  });

  it("repairJsonText reuses extractor behavior", () => {
    expect(repairJsonText('```\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  describe("tryRepairJson", () => {
    it("strips trailing commas before object and array close", () => {
      const repaired = tryRepairJson('{"a":1,"b":[1,2,],}');
      expect(repaired).toBe('{"a":1,"b":[1,2]}');
      expect(JSON.parse(repaired ?? "")).toEqual({ a: 1, b: [1, 2] });
    });

    it("escapes an unescaped double quote inside a string value", () => {
      // Agent output with a single stray quote in the middle of a value.
      // Strict parser chokes at the second `"` (column after `Hello`);
      // lenient repair escapes it so the value becomes `Hello"world`.
      const broken = '{"fullResponse":"Hello"world","summary":"ok"}';
      const repaired = tryRepairJson(broken);
      expect(repaired).not.toBeNull();
      const parsed = JSON.parse(repaired ?? "") as Record<string, string>;
      expect(parsed.fullResponse).toBe('Hello"world');
      expect(parsed.summary).toBe("ok");
    });

    it("handles multiple unescaped quotes within a single string value", () => {
      const broken = '{"fullResponse":"He said "hi" to her","summary":"ok"}';
      const repaired = tryRepairJson(broken);
      expect(repaired).not.toBeNull();
      const parsed = JSON.parse(repaired ?? "") as Record<string, string>;
      expect(parsed.fullResponse).toBe('He said "hi" to her');
      expect(parsed.summary).toBe("ok");
    });

    it("returns null for structurally hopeless input", () => {
      // No repair pass can make this grammatical.
      expect(tryRepairJson('{"a":[1,2,{')).toBeNull();
    });

    it("returns the input unchanged when the strict parser already accepts it", () => {
      const valid = '{"a":1,"b":"c"}';
      expect(tryRepairJson(valid)).toBe(valid);
    });

    it("parseJsonObject transparently succeeds after lenient repair", () => {
      // Classic failure mode: unescaped quote caused by a Chinese date
      // wrapped in ASCII quotes in the agent's free-form explanation.
      const broken = '{"fullResponse":"今天是"2026-04-12"星期日","summary":"ok","extractedClaims":[],"judgements":[]}';
      const parsed = parseJsonObject(broken) as Record<string, unknown>;
      expect(parsed.fullResponse).toBe('今天是"2026-04-12"星期日');
      expect(parsed.summary).toBe("ok");
    });
  });
});
