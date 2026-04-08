import { resolve } from "node:path";
import {
  createExampleConfigPath,
  loadCliConfig,
  resolveOutputPath,
  type ResolveConfigPathOptions
} from "./config.js";

export type CliRunOptions = {
  configPath?: string;
  jsonlPath?: string;
};

export type CliResult = {
  ok: boolean;
  code: number;
};

export async function runCli(argv: string[], io: Pick<typeof console, "log" | "error"> = console): Promise<CliResult> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp(io);
    return { ok: true, code: 0 };
  }

  if (command === "version" || command === "--version" || command === "-v") {
    io.log("argue-cli v0.1.0");
    return { ok: true, code: 0 };
  }

  if (command === "run") {
    const options = parseRunOptions(rest);
    if (!options.ok) {
      io.error(options.error);
      return { ok: false, code: 1 };
    }

    let loaded;
    try {
      loaded = await loadCliConfig({ explicitPath: options.value.configPath } satisfies ResolveConfigPathOptions);
    } catch (error) {
      io.error(String(error));
      return { ok: false, code: 1 };
    }

    const jsonlRaw = options.value.jsonlPath ?? loaded.config.output?.jsonlPath ?? "./out/argue.events.jsonl";
    const resultRaw = loaded.config.output?.resultPath ?? "./out/argue.result.json";

    const jsonlPath = resolveOutputPath(jsonlRaw, loaded.configDir);
    const resultPath = resolveOutputPath(resultRaw, loaded.configDir);

    io.log("[argue-cli] configuration loaded");
    io.log(`- config: ${loaded.configPath}`);
    io.log(`- providers: ${Object.keys(loaded.config.providers).length}`);
    io.log(`- agents: ${loaded.config.agents.length}`);
    io.log(`- jsonl: ${jsonlPath}`);
    io.log(`- result: ${resultPath}`);
    io.log("- runtime adapters: TODO (claude/codex/mock)");
    io.log("- host orchestration: TODO (map config agents -> delegate -> ArgueEngine.start)");

    return { ok: true, code: 0 };
  }

  io.error(`Unknown command: ${command}`);
  printHelp(io);
  return { ok: false, code: 1 };
}

function parseRunOptions(args: string[]):
  | { ok: true; value: CliRunOptions }
  | { ok: false; error: string } {
  const out: CliRunOptions = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--config" || arg === "-c") {
      const value = args[i + 1];
      if (!value) {
        return { ok: false, error: "--config requires a path" };
      }
      out.configPath = value;
      i += 1;
      continue;
    }

    if (arg === "--jsonl") {
      const value = args[i + 1];
      if (!value) {
        return { ok: false, error: "--jsonl requires a path" };
      }
      out.jsonlPath = value;
      i += 1;
      continue;
    }

    return { ok: false, error: `Unknown option for run: ${arg}` };
  }

  return { ok: true, value: out };
}

function printHelp(io: Pick<typeof console, "log">): void {
  io.log("argue-cli");
  io.log("");
  io.log("Usage:");
  io.log("  argue run [--config <path>] [--jsonl <path>]");
  io.log("  argue help");
  io.log("  argue version");
  io.log("");
  io.log("Config lookup order (when --config is omitted):");
  io.log("  1) ./argue.config.json");
  io.log(`  2) ${createExampleConfigPath()}`);
}
