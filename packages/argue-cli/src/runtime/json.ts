import { jsonrepair } from "jsonrepair";

/**
 * Error thrown when agent output cannot be parsed as a JSON object, even
 * after attempting lenient repair. Carries both the original `rawText`
 * (whatever the runner captured from the agent) and the `extractedCandidate`
 * (the slice we actually tried to parse, post code-fence stripping and
 * brace-balancing) so callers can surface the full failure state — e.g.
 * dumping raw stdout to disk for offline debugging.
 */
export class JsonParseError extends Error {
  readonly rawText: string;
  readonly extractedCandidate: string | null;

  constructor(message: string, options: { rawText: string; extractedCandidate: string | null; cause?: unknown }) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "JsonParseError";
    this.rawText = options.rawText;
    this.extractedCandidate = options.extractedCandidate;
  }
}

export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

export function extractJsonObject(text: string): string | null {
  const cleaned = stripCodeFences(text);
  if (!cleaned) return null;

  if (looksLikeJson(cleaned)) {
    return cleaned;
  }

  const objectStart = cleaned.indexOf("{");
  if (objectStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < cleaned.length; index += 1) {
    const char = cleaned[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return cleaned.slice(objectStart, index + 1);
      }
    }
  }

  return null;
}

/**
 * Attempt a lenient repair pass on a JSON candidate that failed strict
 * parsing. Delegates to the `jsonrepair` library, which handles a wide
 * range of LLM output glitches via a dedicated state-machine parser:
 *
 *   - unescaped ASCII double-quote inside string values (the dominant
 *     failure mode when agents emit long-form natural language with
 *     inline quoted phrases)
 *   - trailing commas before `}` / `]`
 *   - single-quoted strings / unquoted keys
 *   - JavaScript / Python literals (`undefined`, `NaN`, `True`/`False`)
 *   - truncated output with unclosed strings / brackets
 *   - comments (`//` and `/* *\/`)
 *
 * Returns the repaired JSON text on success, or `null` if even the
 * repair library could not make sense of the input. The caller is
 * responsible for running `JSON.parse` on the returned string.
 */
export function tryRepairJson(candidate: string): string | null {
  try {
    return jsonrepair(candidate);
  } catch {
    return null;
  }
}

/**
 * Syntax-only recovery for stray ASCII double quotes inside string values.
 * Driven by `JSON.parse`'s own error position: each rejection at position
 * P means everything strictly before P parsed cleanly, so the offending
 * quote is the most recent unescaped `"` at or before P. We escape it and
 * retry, up to a small iteration cap. Progress is enforced by requiring
 * the reported error position to strictly advance each round.
 *
 * This pass never inspects task-specific keys or output schemas. It only
 * rewrites raw JSON text so syntax recovery stays generic. Any structural
 * or schema validation still happens later in `normalizeTaskOutput`.
 *
 * This covers failures that `jsonrepair`'s lookahead heuristic trips on —
 * e.g. CJK phrases wrapped in stray ASCII quotes where surrounding
 * characters like `(N)` or fullwidth `（` mislead its "is this a new key?"
 * tie-breaker.
 */
function tryEscapeStrayQuotes(candidate: string): { text: string; iterations: number } | null {
  const MAX_ITERATIONS = 64;
  let text = candidate;
  let lastErrorPos = -1;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    try {
      JSON.parse(text);
      return { text, iterations: iteration };
    } catch (error) {
      if (!(error instanceof SyntaxError)) return null;
      const match = /at position (\d+)/.exec(error.message);
      if (!match) return null;
      const errorPos = Math.min(Number(match[1]), text.length);
      if (errorPos <= lastErrorPos) return null;
      lastErrorPos = errorPos;

      let quotePos = -1;
      for (let j = errorPos; j >= 0; j -= 1) {
        if (text[j] !== '"') continue;
        let backslashes = 0;
        let k = j - 1;
        while (k >= 0 && text[k] === "\\") {
          backslashes += 1;
          k -= 1;
        }
        if (backslashes % 2 === 0) {
          quotePos = j;
          break;
        }
      }
      if (quotePos === -1) return null;

      text = `${text.slice(0, quotePos)}\\${text.slice(quotePos)}`;
    }
  }
  return null;
}

export function parseJsonObject(text: string): unknown {
  const candidate = extractJsonObject(text);
  if (!candidate) {
    throw new JsonParseError("No JSON object found in output", {
      rawText: text,
      extractedCandidate: null
    });
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    // Strict parse failed. First try the general lenient repair path so a
    // single stray unescaped quote (or trailing comma, truncation, etc.)
    // does not eliminate an otherwise-cooperative participant.
    const repaired = tryRepairJson(candidate);
    if (repaired !== null) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Repair produced a syntactically broken result; fall through.
      }
    }

    // Second chance: a narrower, syntax-only stray-quote escape pass that
    // survives the CJK + "(N)" + fullwidth "（" combinations where
    // jsonrepair's heuristic misclassifies the stray quote as a new key.
    // It does not try to repair missing/invalid fields; schema enforcement
    // remains a separate step in normalizeTaskOutput.
    const escaped = tryEscapeStrayQuotes(candidate);
    if (escaped !== null) {
      try {
        const parsed = JSON.parse(escaped.text);
        // Observability: record the fallback so operators can see how
        // often LLM output needs this rescue path in production. Goes to
        // stderr so it never contaminates CLI JSON stdout.
        console.warn(
          `[argue] parseJsonObject: recovered via iterative stray-quote escape ` +
            `(iterations=${escaped.iterations}, candidateLength=${candidate.length})`
        );
        return parsed;
      } catch {
        // Fall through to the hard error below.
      }
    }

    throw new JsonParseError(`Invalid JSON output: ${String(error)}`, {
      rawText: text,
      extractedCandidate: candidate,
      cause: error
    });
  }
}

export function repairJsonText(text: string): string | null {
  return extractJsonObject(text);
}

function looksLikeJson(text: string): boolean {
  return text.startsWith("{") && text.endsWith("}");
}
