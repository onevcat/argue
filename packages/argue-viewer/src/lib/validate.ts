import { ARGUE_RESULT_VERSION, ArgueResultSchema, type ArgueResult } from "@onevcat/argue";

export type ValidationResult = { ok: true; data: ArgueResult } | { ok: false; error: string };

function describePath(path: (string | number)[]): string {
  if (path.length === 0) {
    return "root";
  }

  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".")
    .replace(".[", "[");
}

export function validateArgueResult(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Input must be a JSON object." };
  }

  const candidate = input as { resultVersion?: unknown };
  if (candidate.resultVersion !== ARGUE_RESULT_VERSION) {
    return {
      ok: false,
      error: `Unsupported resultVersion: expected ${ARGUE_RESULT_VERSION}, received ${String(candidate.resultVersion)}.`
    };
  }

  const parsed = ArgueResultSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (!issue) {
      return { ok: false, error: "Validation failed due to an unknown schema error." };
    }
    return {
      ok: false,
      error: `Schema mismatch at ${describePath(issue.path)}: ${issue.message}`
    };
  }

  return { ok: true, data: parsed.data };
}
