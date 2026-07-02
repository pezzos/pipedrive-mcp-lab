import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const repoRoot = process.cwd();
const pluginSourceRoot = join(repoRoot, "plugin", "claude");
const artifactRoot = join(repoRoot, "dist", "claude-plugin", "pipedrive-mcp");

const requiredInputs = [
  join(pluginSourceRoot, ".claude-plugin"),
  join(pluginSourceRoot, "skills"),
  join(pluginSourceRoot, "README.md"),
  join(repoRoot, "INSTALL.md"),
  join(repoRoot, "INSTALL.fr.md"),
  join(repoRoot, "LICENSE"),
];

for (const input of requiredInputs) {
  if (!existsSync(input)) {
    throw new Error(`Missing Claude plugin packaging input: ${input}`);
  }
}

rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(artifactRoot, { recursive: true });

copy(join(pluginSourceRoot, ".claude-plugin"), join(artifactRoot, ".claude-plugin"));
copySkills(join(pluginSourceRoot, "skills"), join(artifactRoot, "skills"));
copy(join(pluginSourceRoot, "README.md"), join(artifactRoot, "README.md"));
copy(join(repoRoot, "INSTALL.md"), join(artifactRoot, "INSTALL.md"));
copy(join(repoRoot, "INSTALL.fr.md"), join(artifactRoot, "INSTALL.fr.md"));
copy(join(repoRoot, "LICENSE"), join(artifactRoot, "LICENSE"));

const pluginDocs = join(repoRoot, "docs", "CLAUDE_COWORK_PLUGIN.md");
if (existsSync(pluginDocs)) {
  copy(pluginDocs, join(artifactRoot, "docs", "CLAUDE_COWORK_PLUGIN.md"));
}

assertCleanArtifact(artifactRoot);
console.log(`Claude plugin artifact staged at ${artifactRoot}`);

function copy(source, target) {
  mkdirSync(join(target, ".."), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: false, filter: artifactFilter });
}

function copySkills(sourceRoot, targetRoot) {
  mkdirSync(targetRoot, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillRoot = join(sourceRoot, entry.name);
    if (!existsSync(join(skillRoot, "SKILL.md"))) {
      continue;
    }
    copy(skillRoot, join(targetRoot, entry.name));
    copied += 1;
  }
  if (copied === 0) {
    throw new Error(`No Claude skills found in ${sourceRoot}`);
  }
}

function artifactFilter(source) {
  const name = basename(source);
  if (name === ".env" || name === ".mcp.json" || name.endsWith(".tgz")) {
    return false;
  }
  return !["src", "tests", "node_modules", "package-lock.json", "dist"].includes(name);
}

function assertCleanArtifact(root) {
  const forbiddenPathParts = new Set(["src", "tests", "node_modules", "dist"]);
  const forbiddenNames = new Set([".env", ".mcp.json", "package-lock.json"]);
  for (const file of walk(root)) {
    const relative = file.slice(root.length + 1);
    const parts = relative.split(/[\\/]/);
    if (parts.some((part) => forbiddenPathParts.has(part))) {
      throw new Error(`Forbidden path in Claude plugin artifact: ${relative}`);
    }
    const name = basename(file);
    if (forbiddenNames.has(name) || name.endsWith(".tgz")) {
      throw new Error(`Forbidden file in Claude plugin artifact: ${relative}`);
    }
    if (/secret|token|credential/i.test(name) && !relative.startsWith("docs/")) {
      throw new Error(`Suspicious secret-like file in Claude plugin artifact: ${relative}`);
    }
  }
}

function* walk(root) {
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}
