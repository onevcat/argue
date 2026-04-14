import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const rootPkgPath = join(repoRoot, "package.json");
const changelogPath = join(repoRoot, "CHANGELOG.md");

const argVersion = process.argv[2];
const version = argVersion ?? JSON.parse(await readFile(rootPkgPath, "utf8")).version;

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node scripts/publish-github-release.mjs [version]");
  console.error("  defaults to the version in root package.json");
  process.exit(1);
}

const tag = `v${version}`;
const changelog = await readFile(changelogPath, "utf8");
const section = extractTopSection(changelog);

if (!section.trim()) {
  console.error(`No "## [..." section found in ${changelogPath}.`);
  process.exit(1);
}

const headingMatch = section.match(/^## \[([^\]]+)\]/);
if (!headingMatch || headingMatch[1] !== version) {
  console.error(
    `CHANGELOG.md top section is for ${headingMatch?.[1] ?? "(unknown)"}, ` +
      `but releasing ${version}. Update CHANGELOG.md before releasing.`
  );
  process.exit(1);
}

console.log(`Creating GitHub release ${tag} from CHANGELOG.md...`);
const result = spawnSync("gh", ["release", "create", tag, "--title", tag, "--notes", section], { stdio: "inherit" });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

function extractTopSection(text) {
  const lines = text.split("\n");
  const out = [];
  let started = false;
  for (const line of lines) {
    if (line.startsWith("## [")) {
      if (started) break;
      started = true;
    }
    if (started) out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
