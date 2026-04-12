import { ARGUE_RESULT_VERSION, ArgueResultSchema, type ArgueResult } from "@onevcat/argue";

export type ValidationResult = { ok: true; data: ArgueResult } | { ok: false; error: string };

function describePath(path: (string | number)[]): string {
  if (path.length === 0) {
    return "root";
  }

  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".")
    .replace(/\.\[/g, "[");
}

export function validateArgueResult(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Input must be a JSON object." };
  }

  const candidate = input as Record<string, unknown>;

  // Backward compat: results produced before the resultVersion field existed
  // are treated as version 1 so existing artifacts keep loading. Any
  // explicitly set version must still match the current one.
  let normalised: Record<string, unknown>;
  if (candidate.resultVersion === undefined) {
    normalised = { ...candidate, resultVersion: ARGUE_RESULT_VERSION };
  } else if (candidate.resultVersion !== ARGUE_RESULT_VERSION) {
    return {
      ok: false,
      error: `Unsupported resultVersion: expected ${ARGUE_RESULT_VERSION}, received ${String(candidate.resultVersion)}.`
    };
  } else {
    normalised = candidate;
  }

  const parsed = ArgueResultSchema.safeParse(normalised);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    const first = issues[0];
    if (!first) {
      return { ok: false, error: "Validation failed due to an unknown schema error." };
    }
    const head = `Schema mismatch at ${describePath(first.path)}: ${first.message}`;
    const suffix =
      issues.length > 1 ? ` (and ${issues.length - 1} more issue${issues.length - 1 === 1 ? "" : "s"})` : "";
    return { ok: false, error: `${head}${suffix}` };
  }

  return { ok: true, data: parsed.data };
}
