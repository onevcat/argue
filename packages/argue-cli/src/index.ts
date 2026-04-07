import { access } from "node:fs/promises";
import { resolve } from "node:path";

export type CliRunOptions = {
  configPath?: string;
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

    const configPath = options.value.configPath
      ? resolve(options.value.configPath)
      : undefined;

    if (!configPath) {
      io.error("Missing --config <path>. Example: argue run --config ./argue.config.json");
      return { ok: false, code: 1 };
    }

    try {
      await access(configPath);
    } catch {
      io.error(`Config file not found: ${configPath}`);
      return { ok: false, code: 1 };
    }

    io.log(`[argue-cli] skeleton ready`);
    io.log(`- command: run`);
    io.log(`- config: ${configPath}`);
    io.log("- runtime adapters: TODO (claude/codex/mock)");
    io.log("- host orchestration: TODO (wire AgentTaskDelegate and start ArgueEngine)");

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

    return { ok: false, error: `Unknown option for run: ${arg}` };
  }

  return { ok: true, value: out };
}

function printHelp(io: Pick<typeof console, "log">): void {
  io.log("argue-cli (skeleton)");
  io.log("");
  io.log("Usage:");
  io.log("  argue run --config <path>");
  io.log("  argue help");
  io.log("  argue version");
}
