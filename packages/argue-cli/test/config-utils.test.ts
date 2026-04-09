import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createExampleConfigPath,
  readJsonFile,
  resolveConfigPath,
  resolveOutputPath,
  resolvePath
} from "../src/config.js";

describe("config utilities", () => {
  it("resolveConfigPath falls back to global path", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-config-global-"));
    const cwd = join(root, "cwd");
    const home = join(root, "home");
    const globalPath = join(home, ".config", "argue", "config.json");

    await mkdir(cwd, { recursive: true });
    await mkdir(join(home, ".config", "argue"), { recursive: true });
    await writeFile(globalPath, JSON.stringify({ schemaVersion: 1 }), "utf8");

    const resolved = await resolveConfigPath({ cwd, homeDir: home });
    expect(resolved).toBe(globalPath);
  });

  it("resolveConfigPath throws for missing explicit path", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-config-missing-"));
    const missing = join(root, "none.json");

    await expect(resolveConfigPath({ explicitPath: missing, cwd: root })).rejects.toThrow(/Config file not found/);
  });

  it("readJsonFile throws when json is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "argue-cli-json-invalid-"));
    const path = join(root, "bad.json");
    await writeFile(path, "{bad", "utf8");

    await expect(readJsonFile(path)).rejects.toThrow(/Invalid JSON/);
  });

  it("resolves relative paths and requestId placeholders", () => {
    expect(resolvePath("./out/a.json", "/tmp/proj")).toBe("/tmp/proj/out/a.json");
    expect(resolveOutputPath("./out/{requestId}.json", "/tmp/proj", "abc")).toBe("/tmp/proj/out/abc.json");
    expect(createExampleConfigPath("/home/me")).toBe("/home/me/.config/argue/config.json");
  });
});
