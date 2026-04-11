import type { ActionTaskInput, AgentTaskInput } from "@onevcat/argue";
import type { ResolvedAgentRuntime } from "./types.js";
import { getTaskOutputJsonSchema } from "./task-output.js";

export function buildTaskPrompt(args: {
  task: AgentTaskInput;
  agent: ResolvedAgentRuntime;
  includeJsonSchema: boolean;
}): string {
  const { task, agent, includeJsonSchema } = args;

  if (task.kind === "action") {
    return buildActionPrompt(task, agent);
  }

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

  sections.push("", "Task prompt:", task.prompt);

  sections.push("", "Task context JSON:", JSON.stringify(task, null, 2));

  if (includeJsonSchema) {
    sections.push("", "Expected output JSON schema:", JSON.stringify(getTaskOutputJsonSchema(task), null, 2));
  }

  return sections.join("\n");
}

function buildActionPrompt(task: ActionTaskInput, agent: ResolvedAgentRuntime): string {
  const sections: string[] = [
    "You are executing an action based on a completed argue debate session.",
    "The debate has concluded and you are now tasked with performing real-world operations based on the outcome."
  ];

  if (agent.role) {
    sections.push(`Role: ${agent.role}`);
  }

  if (agent.systemPrompt) {
    sections.push("", "System instructions:", agent.systemPrompt);
  }

  sections.push("", "Action instructions:", task.prompt);

  sections.push(
    "",
    "Debate result:",
    `Status: ${task.argueResult.status}`,
    "",
    "Summary:",
    task.argueResult.finalSummary,
    "",
    "Representative statement:",
    task.argueResult.representativeSpeech
  );

  if (task.argueResult.claims.length > 0) {
    sections.push("", "Claims:");
    for (const claim of task.argueResult.claims) {
      const resolution = task.argueResult.claimResolutions.find((r) => r.claimId === claim.claimId);
      const voteStr = resolution ? ` (${resolution.acceptCount}/${resolution.totalVoters} accept)` : "";
      sections.push(`- ${claim.claimId}: ${claim.title}${voteStr}`);
      sections.push(`  ${claim.statement}`);
    }
  }

  if (task.fullResult) {
    sections.push("", "Full result JSON:", JSON.stringify(task.fullResult, null, 2));
  }

  return sections.join("\n");
}
