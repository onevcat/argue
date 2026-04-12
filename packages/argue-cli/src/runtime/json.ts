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
 * parsing. Returns the repaired string on success, or `null` if repair
 * was not possible. This function should only be called after strict
 * `JSON.parse` has already failed; it is intentionally cheap and does
 * not introduce any new dependencies.
 *
 * Handled failure modes (covers the long tail of LLM output glitches):
 *
 *   1. Trailing commas in objects/arrays — stripped once up front.
 *   2. Unescaped ASCII double-quote inside a string value — detected
 *      position-by-position via `JSON.parse` error feedback, then the
 *      offending quote is escaped in place. Iterated with a small budget
 *      so we can fix multiple bad quotes in a single payload.
 *
 * Not handled: semantic errors (missing required fields, wrong types),
 * truncated output with unclosed nested structures beyond a trivial
 * brace count, mixed escape sequences, non-UTF-8 bytes. Those remain
 * hard failures and still surface as `JsonParseError`.
 */
export function tryRepairJson(candidate: string): string | null {
  // Pass 1: strip trailing commas before object/array close. This alone
  // fixes a common class of LLM typos without touching string content.
  let text = candidate.replace(/,(\s*[}\]])/g, "$1");

  // Sanity: if the pass-1 fix alone makes the JSON valid, bail out early.
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continue to quote-escape pass
  }

  // Pass 2: position-guided quote escaping. Each iteration asks V8's
  // JSON parser where it choked, walks backwards from that position to
  // find the most recent unescaped ASCII double quote, and escapes it.
  // A small iteration budget and a seen-position guard prevent infinite
  // loops on inputs we cannot fix.
  const maxAttempts = 8;
  const seenPositions = new Set<number>();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      JSON.parse(text);
      return text;
    } catch (error) {
      if (!(error instanceof SyntaxError)) return null;

      const match = /position (\d+)/i.exec(error.message);
      if (!match?.[1]) return null;

      const pos = Number(match[1]);
      if (seenPositions.has(pos)) return null;
      seenPositions.add(pos);

      const fixPos = findPreviousUnescapedQuote(text, pos);
      if (fixPos === -1) return null;

      text = `${text.slice(0, fixPos)}\\${text.slice(fixPos)}`;
    }
  }

  return null;
}

/**
 * Walk backwards from `before` looking for the first `"` whose preceding
 * run of `\\` characters has even parity (i.e. the quote itself is not
 * already escaped). Returns the index of the quote, or -1 if none found.
 */
function findPreviousUnescapedQuote(text: string, before: number): number {
  for (let i = before - 1; i >= 0; i -= 1) {
    if (text[i] !== '"') continue;
    let backslashes = 0;
    let j = i - 1;
    while (j >= 0 && text[j] === "\\") {
      backslashes += 1;
      j -= 1;
    }
    if (backslashes % 2 === 0) {
      return i;
    }
  }
  return -1;
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
    // Strict parse failed. Try the lenient repair path before surfacing
    // a hard error so a single stray unescaped quote does not eliminate
    // an otherwise-cooperative participant.
    const repaired = tryRepairJson(candidate);
    if (repaired !== null) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Repair produced a syntactically broken result; fall through to
        // the hard error below.
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
