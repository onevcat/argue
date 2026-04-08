import type { AgentTaskInput } from "argue";
import type { ResolvedAgentRuntime } from "./types.js";
import { getTaskOutputJsonSchema } from "./task-output.js";

export function buildTaskPrompt(args: {
  task: AgentTaskInput;
  agent: ResolvedAgentRuntime;
  includeJsonSchema: boolean;
}): string {
  const { task, agent, includeJsonSchema } = args;

  const sections: string[] = [
    "You are executing one task in the argue CLI host.",
    "Return one JSON object only. Do not add markdown, code fences, or commentary."
  ];

  if (agent.role) {
    sections.push(`Role: ${agent.role}`);
  }

  if (agent.systemPrompt) {
    sections.push("", "System instructions:", agent.systemPrompt);
  }

  sections.push(
    "",
    "Task prompt:",
    task.prompt
  );

  sections.push(
    "",
    "Task context JSON:",
    JSON.stringify(task, null, 2)
  );

  if (includeJsonSchema) {
    sections.push(
      "",
      "Expected output JSON schema:",
      JSON.stringify(getTaskOutputJsonSchema(task), null, 2)
    );
  }

  return sections.join("\n");
}
