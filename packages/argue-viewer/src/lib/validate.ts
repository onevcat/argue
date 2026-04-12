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
