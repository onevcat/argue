import { ArgueEngine, JsonlObserver, MemorySessionStore } from "argue";
import type { LoadedCliConfig } from "./config.js";
import type { ResolvedRunPlan } from "./run-plan.js";
import { writeRunArtifacts } from "./artifacts.js";
import { createTaskDelegate } from "./runtime/delegate.js";

export async function executeHeadlessRun(args: {
  loadedConfig: LoadedCliConfig;
  plan: ResolvedRunPlan;
}): Promise<{
  result: Awaited<ReturnType<ArgueEngine["start"]>>;
  jsonlPath: string;
  resultPath: string;
  summaryPath: string;
}> {
  const observer = new JsonlObserver({ path: args.plan.jsonlPath, append: false });
  const taskDelegate = await createTaskDelegate(args);
  const engine = new ArgueEngine({
    taskDelegate,
    observer,
    sessionStore: new MemorySessionStore()
  });

  let result: Awaited<ReturnType<ArgueEngine["start"]>>;
  try {
    result = await engine.start(args.plan.startInput);
  } finally {
    await observer.flush();
  }

  await writeRunArtifacts({
    result,
    resultPath: args.plan.resultPath,
    summaryPath: args.plan.summaryPath
  });

  return {
    result,
    jsonlPath: args.plan.jsonlPath,
    resultPath: args.plan.resultPath,
    summaryPath: args.plan.summaryPath
  };
}
