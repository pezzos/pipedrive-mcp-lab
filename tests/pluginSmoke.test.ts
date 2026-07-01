import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const readOnlyToolCount = 46;
const artifactRoot = join(process.cwd(), "dist", "claude-plugin", "pipedrive-mcp");
const expectedSkillNames = [
  "pipedrive-add-activity",
  "pipedrive-add-note",
  "pipedrive-complete-activity",
  "pipedrive-dictation-aliases",
  "pipedrive-email-activity",
  "pipedrive-next-action",
  "pipedrive-update-record",
];

test("standalone MCP server bundle exposes the read-only profile directly", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const tools = await listTools(join(process.cwd(), "dist", "plugin-server.js"), process.cwd());
  assertReadOnlyProfile(tools);
});

test("standalone MCP server bundle starts before credentials are configured", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const tools = await listTools(join(process.cwd(), "dist", "plugin-server.js"), process.cwd(), {
    PIPEDRIVE_API_TOKEN: undefined,
  });
  assertReadOnlyProfile(tools);
});

test("staged Claude plugin artifact is isolated and read-only by default", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "pack:claude-plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const pluginJsonPath = join(artifactRoot, ".claude-plugin", "plugin.json");
  assert.equal(existsSync(pluginJsonPath), true);
  const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
  assert.equal(pluginJson.version, "0.1.4");
  assert.equal(pluginJson.skills, "./skills/");
  assert.equal("mcpServers" in pluginJson, false);
  assert.equal("userConfig" in pluginJson, false);
  assert.equal(existsSync(join(artifactRoot, ".mcp.json")), false);
  assert.equal(existsSync(join(artifactRoot, "dist", "plugin-server.js")), false);
  const skillNames = readdirSync(join(artifactRoot, "skills")).sort();
  assert.deepEqual(skillNames, expectedSkillNames);
  for (const skillName of expectedSkillNames) {
    assert.equal(existsSync(join(artifactRoot, "skills", skillName, "SKILL.md")), true);
  }

  for (const skillDir of skillNames) {
    const skillPath = join(artifactRoot, "skills", skillDir, "SKILL.md");
    const skillText = readFileSync(skillPath, "utf8");
    assert.match(skillText, /Requires Pipedrive MCP\./);
    assert.match(skillText, /Use only `pipedrive_\*` tools\./);
    assert.match(skillText, /Do not use the official Pipedrive connector\./);
  }

  assertCleanArtifact(artifactRoot);
});

async function listTools(serverPath: string, cwd: string, overrides: Record<string, string | undefined> = {}) {
  const client = new Client({ name: "plugin-smoke", version: "0.1.0" });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    PIPEDRIVE_LOAD_DOTENV: "false",
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
    PIPEDRIVE_API_TOKEN: "test-token",
    PIPEDRIVE_ENABLE_WRITES: "false",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd,
    env,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

function assertReadOnlyProfile(tools: string[]) {
  assert.equal(tools.length, readOnlyToolCount);
  assert.equal(tools.includes("pipedrive_health_check"), true);
  assert.equal(tools.includes("pipedrive_mailbox_probe"), false);
  assert.equal(tools.includes("pipedrive_delete_deal"), false);
  assert.equal(tools.includes("pipedrive_create_deal"), false);
}

function assertCleanArtifact(root: string) {
  for (const file of walk(root)) {
    const relative = file.slice(root.length + 1);
    const parts = relative.split(/[\\/]/);
    assert.equal(parts.includes("src"), false, `artifact must not include src: ${relative}`);
    assert.equal(parts.includes("tests"), false, `artifact must not include tests: ${relative}`);
    assert.equal(parts.includes("node_modules"), false, `artifact must not include node_modules: ${relative}`);
    assert.equal(parts.includes("dist"), false, `artifact must not include bundled server files: ${relative}`);
    assert.equal(parts.includes("package-lock.json"), false, `artifact must not include package-lock.json: ${relative}`);
    assert.equal(parts.includes(".env"), false, `artifact must not include .env: ${relative}`);
    assert.equal(parts.includes(".mcp.json"), false, `artifact must not include MCP server config: ${relative}`);
    assert.equal(relative.endsWith(".tgz"), false, `artifact must not include tarballs: ${relative}`);
    assert.equal(
      /secret|token|credential/i.test(basename(file)) && !relative.startsWith("docs/"),
      false,
      `artifact must not include secret-like files outside docs: ${relative}`,
    );
  }
}

function* walk(root: string): Generator<string> {
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
