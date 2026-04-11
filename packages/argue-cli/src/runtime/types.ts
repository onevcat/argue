import type { AgentTaskInput } from "@onevcat/argue";
import type {
  ApiProviderConfig,
  CliAgentConfig,
  CliProviderConfig,
  MockProviderConfig,
  ProviderConfig,
  ProviderModelConfig,
  SdkProviderConfig
} from "../config.js";

export type ResolvedAgentRuntime = CliAgentConfig & {
  providerName: string;
  providerConfig: ProviderConfig;
  modelConfig: ProviderModelConfig;
  providerModel: string;
};

export type ProviderTaskRunnerArgs = {
  task: AgentTaskInput;
  agent: ResolvedAgentRuntime;
  abortSignal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
};

export interface ProviderTaskRunner {
  runTask(args: ProviderTaskRunnerArgs): Promise<unknown>;
}

export interface CliSdkProviderAdapter {
  runTask(args: ProviderTaskRunnerArgs): Promise<unknown>;
}

export type CreateCliSdkProviderAdapter = (args: {
  providerName: string;
  provider: SdkProviderConfig;
  resolvePath: (path: string) => string;
  environment: NodeJS.ProcessEnv;
}) => Promise<CliSdkProviderAdapter> | CliSdkProviderAdapter;

export type ProviderFactoryContext = {
  configDir: string;
  providerName: string;
};

export type RuntimeProviderConfig = ApiProviderConfig | CliProviderConfig | MockProviderConfig | SdkProviderConfig;
