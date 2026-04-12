import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("Usage: node scripts/bump-version.mjs <version>");
  console.error("  e.g. node scripts/bump-version.mjs 0.2.0");
  process.exit(1);
}

const libPkg = join(repoRoot, "packages", "argue", "package.json");
const cliPkg = join(repoRoot, "packages", "argue-cli", "package.json");

await bumpField(libPkg, "version", version);
await bumpField(cliPkg, "version", version);
await bumpDep(cliPkg, "@onevcat/argue", `^${version}`);

console.log(`Bumped to ${version}. Run \`npm install\` to sync the lockfile.`);

async function bumpField(path, field, value) {
  const text = await readFile(path, "utf8");
  const pkg = JSON.parse(text);
  const old = pkg[field];
  pkg[field] = value;
  await writeFile(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${path}: ${field} ${old} -> ${value}`);
}

async function bumpDep(path, dep, range) {
  const text = await readFile(path, "utf8");
  const pkg = JSON.parse(text);
  const old = pkg.dependencies?.[dep];
  if (old === undefined) {
    console.warn(`  ${path}: dependency ${dep} not found, skipped`);
    return;
  }
  pkg.dependencies[dep] = range;
  await writeFile(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ${path}: ${dep} ${old} -> ${range}`);
}
