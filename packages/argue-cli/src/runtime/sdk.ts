import { pathToFileURL } from "node:url";
import { resolvePath } from "../config.js";
import type { SdkProviderConfig } from "../config.js";
import type { CliSdkProviderAdapter, CreateCliSdkProviderAdapter, ProviderTaskRunner } from "./types.js";

export async function createSdkRunner(
  providerName: string,
  provider: SdkProviderConfig,
  configDir: string
): Promise<ProviderTaskRunner> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...(provider.env ?? {})
  };

  const adapter = await loadAdapter(providerName, provider, configDir, environment);
  return {
    runTask(args) {
      return adapter.runTask({
        ...args,
        environment
      });
    }
  };
}

async function loadAdapter(
  providerName: string,
  provider: SdkProviderConfig,
  configDir: string,
  environment: NodeJS.ProcessEnv
): Promise<CliSdkProviderAdapter> {
  const adapterPath = isLocalModuleSpecifier(provider.adapter)
    ? resolvePath(provider.adapter, configDir)
    : provider.adapter;
  const module = isLocalModuleSpecifier(provider.adapter)
    ? await import(pathToFileURL(adapterPath).href)
    : await import(adapterPath);
  const exportName = provider.exportName ?? "createArgueSdkAdapter";
  const factory = module[exportName] as CreateCliSdkProviderAdapter | undefined;

  if (typeof factory !== "function") {
    throw new Error(`SDK provider '${providerName}' is missing export '${exportName}' in ${adapterPath}`);
  }

  return factory({
    providerName,
    provider,
    resolvePath: (path) => resolvePath(path, configDir),
    environment
  });
}

function isLocalModuleSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("..");
}
