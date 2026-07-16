import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { assertSafeTextTree } from "./lib/artifact-safety.mjs";

const repoRoot = process.cwd();
const pluginSourceRoot = join(repoRoot, "plugin", "claude");
const artifactRoot = join(repoRoot, "dist", "claude-plugin", "pipedrive-mcp");
const bundledDocs = ["CLAUDE_DELIVERY.md", "REMOTE_MCP_CLOUDFLARE.md"];
const remoteMcpPath = join(pluginSourceRoot, ".mcp.json");
const expectedRemoteMcpUrl = "https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp";

const requiredInputs = [
  join(pluginSourceRoot, ".claude-plugin"),
  remoteMcpPath,
  join(pluginSourceRoot, "skills"),
  join(pluginSourceRoot, "README.md"),
  join(repoRoot, "INSTALL.md"),
  join(repoRoot, "INSTALL.fr.md"),
  join(repoRoot, "LICENSE"),
  ...bundledDocs.map((docName) => join(repoRoot, "docs", docName)),
];

for (const input of requiredInputs) {
  if (!existsSync(input)) {
    throw new Error(`Missing Claude plugin packaging input: ${input}`);
  }
}

rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(artifactRoot, { recursive: true });

copy(join(pluginSourceRoot, ".claude-plugin"), join(artifactRoot, ".claude-plugin"));
copy(remoteMcpPath, join(artifactRoot, ".mcp.json"));
copySkills(join(pluginSourceRoot, "skills"), join(artifactRoot, "skills"));
copy(join(pluginSourceRoot, "README.md"), join(artifactRoot, "README.md"));
copy(join(repoRoot, "INSTALL.md"), join(artifactRoot, "INSTALL.md"));
copy(join(repoRoot, "INSTALL.fr.md"), join(artifactRoot, "INSTALL.fr.md"));
copy(join(repoRoot, "LICENSE"), join(artifactRoot, "LICENSE"));

for (const docName of bundledDocs) {
  copy(join(repoRoot, "docs", docName), join(artifactRoot, "docs", docName));
}

assertRemoteMcpConfig(join(artifactRoot, ".mcp.json"));
assertSafeTextTree(artifactRoot, { allowedMcpConfig: ".mcp.json" });
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
  if (name === ".env" || name.endsWith(".tgz")) {
    return false;
  }
  return !["src", "tests", "node_modules", "package-lock.json", "dist"].includes(name);
}

function assertRemoteMcpConfig(path) {
  const config = JSON.parse(readFileSync(path, "utf8"));
  const serverNames = Object.keys(config.mcpServers ?? {});
  if (serverNames.length !== 1 || serverNames[0] !== "pipedrive-mcp") {
    throw new Error("Claude plugin .mcp.json must declare exactly the pipedrive-mcp server");
  }
  const server = config.mcpServers["pipedrive-mcp"];
  const keys = Object.keys(server ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["type", "url"])) {
    throw new Error("Claude plugin remote MCP config may contain only type and url");
  }
  if (server.type !== "http" || server.url !== expectedRemoteMcpUrl) {
    throw new Error(`Claude plugin remote MCP must use ${expectedRemoteMcpUrl}`);
  }
}
