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

    if (char === "\"") {
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

export function parseJsonObject(text: string): unknown {
  const candidate = extractJsonObject(text);
  if (!candidate) {
    throw new Error("No JSON object found in output");
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error(`Invalid JSON output: ${String(error)}`);
  }
}

export function repairJsonText(text: string): string | null {
  return extractJsonObject(text);
}

function looksLikeJson(text: string): boolean {
  return text.startsWith("{") && text.endsWith("}");
}
