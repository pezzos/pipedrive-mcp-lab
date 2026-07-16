import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafeTextTree } from "./lib/artifact-safety.mjs";

const repoRoot = process.cwd();
const sourceRoot = join(repoRoot, "plugin", "claude", "skills");
const artifactRoot = join(repoRoot, "dist", "claude-skills");
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

if (!existsSync(sourceRoot)) {
  throw new Error(`Missing Claude skills source: ${sourceRoot}`);
}

rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(artifactRoot, { recursive: true });

const skills = [];
for (const entry of readdirSync(sourceRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
  if (!entry.isDirectory()) {
    continue;
  }
  const skillRoot = join(sourceRoot, entry.name);
  if (!existsSync(join(skillRoot, "SKILL.md"))) {
    continue;
  }
  const skillSource = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  const declaredName = skillSource.match(/^---\s*$[\s\S]*?^name:\s*([^\s]+)\s*$/m)?.[1];
  if (declaredName !== entry.name) {
    throw new Error(`${entry.name}/SKILL.md declares name ${declaredName ?? "<missing>"}`);
  }
  assertSafeTextTree(skillRoot);

  const stagingRoot = join(artifactRoot, `.staging-${entry.name}`);
  const stagedSkillRoot = join(stagingRoot, entry.name);
  mkdirSync(stagingRoot, { recursive: true });
  cpSync(skillRoot, stagedSkillRoot, { recursive: true, dereference: false });

  const versionedName = `${entry.name}-${packageVersion}.zip`;
  const latestName = `${entry.name}-latest.zip`;
  const versionedPath = join(artifactRoot, versionedName);
  execFileSync("zip", ["-X", "-qr", versionedPath, entry.name], { cwd: stagingRoot, stdio: "pipe" });
  cpSync(versionedPath, join(artifactRoot, latestName));
  rmSync(stagingRoot, { recursive: true, force: true });

  const members = listArchiveMembers(versionedPath);
  if (!members.includes(`${entry.name}/SKILL.md`)) {
    throw new Error(`${versionedName} is missing ${entry.name}/SKILL.md`);
  }
  skills.push({
    name: entry.name,
    versioned: versionedName,
    latest: latestName,
    content_sha256: normalizedZipDigest(versionedPath),
  });
}

if (skills.length === 0) {
  throw new Error(`No Claude skills found in ${sourceRoot}`);
}

writeFileSync(
  join(artifactRoot, "manifest.json"),
  `${JSON.stringify({ version: packageVersion, skills }, null, 2)}\n`,
  "utf8",
);

console.log(`Standalone Claude skills staged at ${artifactRoot}`);

function normalizedZipDigest(path) {
  const digest = createHash("sha256");
  for (const member of listArchiveMembers(path).filter((name) => !name.endsWith("/")).sort()) {
    digest.update(member);
    digest.update("\0");
    digest.update(createHash("sha256").update(execFileSync("unzip", ["-p", path, member])).digest("hex"));
    digest.update("\n");
  }
  return digest.digest("hex");
}

function listArchiveMembers(path) {
  return execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
}
