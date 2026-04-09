import { ArgueEngine, JsonlObserver, MemorySessionStore, type ArgueEvent, type ArgueObserver } from "argue";
import type { LoadedCliConfig } from "./config.js";
import type { ResolvedRunPlan } from "./run-plan.js";
import { writeRunArtifacts } from "./artifacts.js";
import { createTaskDelegate } from "./runtime/delegate.js";

export async function executeHeadlessRun(args: {
  loadedConfig: LoadedCliConfig;
  plan: ResolvedRunPlan;
  onEvent?: (event: ArgueEvent) => void | Promise<void>;
}): Promise<{
  result: Awaited<ReturnType<ArgueEngine["start"]>>;
  jsonlPath: string;
  resultPath: string;
  summaryPath: string;
}> {
  const jsonlObserver = new JsonlObserver({ path: args.plan.jsonlPath, append: false });
  const observer: ArgueObserver = {
    onEvent: async (event) => {
      await jsonlObserver.onEvent(event);
      if (!args.onEvent) return;
      try {
        await args.onEvent(event);
      } catch {
        // ignore progress rendering failures
      }
    }
  };
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
    await jsonlObserver.flush();
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
