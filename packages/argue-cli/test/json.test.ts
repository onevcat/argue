import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  extractJsonObject,
  JsonParseError,
  parseJsonObject,
  repairJsonText,
  stripCodeFences,
  tryRepairJson
} from "../src/runtime/json.js";

const FIXTURE_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

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

  it("V8 SyntaxError.message exposes 'at position N' for stray-quote failures (the fallback depends on this)", () => {
    // The iterative stray-quote fallback inside parseJsonObject parses
    // the error position out of SyntaxError.message via /at position (\d+)/.
    // That substring is a V8 implementation detail — Node.js 21 already
    // dropped it from the generic "Unexpected token X" family, but the
    // specific error raised by a stray ASCII quote inside a string value
    // is "Expected ',' or '}' after property value in JSON at position N",
    // which still carries the position in Node 20/22. Lock that exact
    // family here: any node upgrade that renames or drops the position
    // for *this* error must fail this test loudly, not silently disable
    // the fallback.
    let caught: unknown;
    try {
      JSON.parse('{"a":"b"c":1}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SyntaxError);
    const message = String((caught as SyntaxError).message);
    expect(message).toMatch(/after property value/);
    expect(message).toMatch(/at position \d+/);
  });

  it("parseJsonObject emits a stderr warning when the stray-quote fallback rescues a payload", () => {
    // Observability lock: when the fallback path is the thing that saves
    // a payload, we want a visible signal (stderr warn) so operators can
    // watch how often LLM output regresses into needing this rescue.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const broken = readFileSync(
        join(FIXTURE_DIR, "claude-final-vote-stray-quotes-fullwidth-paren.txt"),
        "utf8"
      ).trim();
      parseJsonObject(broken);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message] = warnSpy.mock.calls[0] ?? [];
      expect(String(message)).toMatch(/iterative stray-quote escape/);
      expect(String(message)).toMatch(/iterations=\d+/);
      expect(String(message)).toMatch(/candidateLength=\d+/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("parseJsonObject recovers payloads where jsonrepair's stray-quote heuristic fails on '(N) \"CJK\"（' patterns", () => {
    // Captured from argue_1776185225898_944d69 (final_vote round 4).
    // The embedded Chinese fullResponse contains stray ASCII quote pairs
    // around phrases like "弱客观性" / "强形上客观性", each preceded by
    // structural noise like "立场；(3)" and followed by a fullwidth "（".
    // This combination defeats jsonrepair's stray-quote lookahead — it
    // starts parsing the CJK phrase as an unquoted key and throws
    // "Colon expected" — so parseJsonObject must fall back to a
    // syntax-only iterative-escape recovery path. Output schema
    // validation is intentionally handled later by normalizeTaskOutput.
    const broken = readFileSync(join(FIXTURE_DIR, "claude-final-vote-stray-quotes-fullwidth-paren.txt"), "utf8").trim();

    // Document the baseline: jsonrepair alone cannot salvage this input.
    // If a future jsonrepair release handles it, this assertion will
    // flag that the fallback is no longer load-bearing for this case.
    expect(tryRepairJson(broken)).toBeNull();

    const parsed = parseJsonObject(broken) as Record<string, unknown>;

    expect(parsed.fullResponse).toBeTruthy();
    expect(parsed.summary).toBeTruthy();
    expect(Array.isArray(parsed.judgements)).toBe(true);
    expect(Array.isArray(parsed.claimVotes)).toBe(true);

    const fullResponse = String(parsed.fullResponse);
    expect(fullResponse).toContain('"弱客观性"');
    expect(fullResponse).toContain('"强形上客观性"');

    const judgements = parsed.judgements as Array<Record<string, unknown>>;
    const claimVotes = parsed.claimVotes as Array<Record<string, unknown>>;
    expect(judgements).toHaveLength(18);
    expect(claimVotes).toHaveLength(18);
    expect(judgements[0]?.claimId).toBe("claude-agent:0:0");
    expect(claimVotes[17]?.claimId).toBe("claude-agent:3:0");
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

    it("returns null for truly ungrammatical input that even jsonrepair cannot salvage", () => {
      // jsonrepair is quite forgiving — even dangling structures like
      // '{"a":[1,2,{' get closed as '{"a":[1,2,{}]}'. To force a hard
      // failure we need something that has no recoverable structure at
      // all, e.g. an empty brace balanced fragment with only a key and
      // no colon/value and tokens that cannot be coerced.
      expect(tryRepairJson("}{][")).toBeNull();
    });

    it("returns parseable text for input the strict parser already accepts", () => {
      const valid = '{"a":1,"b":"c"}';
      const repaired = tryRepairJson(valid);
      expect(repaired).not.toBeNull();
      expect(JSON.parse(repaired ?? "")).toEqual({ a: 1, b: "c" });
    });

    it("recovers a real claude debate-round output with 4 unescaped quote pairs spread across fullResponse and rationale fields", () => {
      // This fixture is the raw stdout captured from a real argue run
      // (argue_1775979354178) where claude-agent emitted a long Chinese
      // response containing multiple unescaped ASCII-quoted sub-phrases
      // in both the fullResponse string and two separate rationale
      // strings. Previously crashed the run; must now parse cleanly.
      const broken = readFileSync(join(FIXTURE_DIR, "claude-debate-2-unescaped-quotes.txt"), "utf8").trim();
      const parsed = parseJsonObject(broken) as Record<string, unknown>;

      // Top-level structure survives.
      expect(parsed.fullResponse).toBeTruthy();
      expect(parsed.summary).toBeTruthy();
      expect(Array.isArray(parsed.judgements)).toBe(true);

      // The embedded quoted phrases are now part of the string values
      // verbatim, with their ASCII quotes preserved.
      expect(parsed.fullResponse).toContain('"该主张与更早条目重复，保留早先主张即可"');
      expect(parsed.fullResponse).toContain('"在时区已明确时直接按会话时区回答"');

      const judgements = parsed.judgements as Array<Record<string, unknown>>;
      expect(judgements).toHaveLength(3);
      expect(judgements[0]?.claimId).toBe("claude-agent:0:0");
      expect(judgements[0]?.stance).toBe("revise");
      expect(String(judgements[0]?.rationale)).toContain('"重复，保留早先主张即可"');
      expect(judgements[1]?.claimId).toBe("codex-agent:0:1");
      expect(String(judgements[1]?.rationale)).toContain('"本会话时区已明确"');
      expect(judgements[2]?.claimId).toBe("codex-agent:0:2");
    });
  });
});
