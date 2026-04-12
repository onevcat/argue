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
