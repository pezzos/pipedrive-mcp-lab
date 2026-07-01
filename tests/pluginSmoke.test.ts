import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const readOnlyToolCount = 46;
const artifactRoot = join(process.cwd(), "dist", "claude-plugin", "pipedrive-mcp");

test("bundled plugin server exposes the read-only profile directly", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const tools = await listTools(join(process.cwd(), "dist", "plugin-server.js"), process.cwd());
  assertReadOnlyProfile(tools);
});

test("bundled plugin server starts before credentials are configured", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const tools = await listTools(join(process.cwd(), "dist", "plugin-server.js"), process.cwd(), {
    PIPEDRIVE_API_TOKEN: undefined,
  });
  assertReadOnlyProfile(tools);
});

test("staged Claude plugin artifact is isolated and read-only by default", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "pack:claude-plugin"], { cwd: process.cwd(), stdio: "pipe" });

  assert.equal(existsSync(join(artifactRoot, ".claude-plugin", "plugin.json")), true);
  assert.equal(existsSync(join(artifactRoot, ".mcp.json")), true);
  assert.equal(existsSync(join(artifactRoot, "skills", "pipedrive-add-activity", "SKILL.md")), true);
  assert.equal(existsSync(join(artifactRoot, "skills", "pipedrive-dictation-aliases", "SKILL.md")), true);
  assert.equal(existsSync(join(artifactRoot, "dist", "plugin-server.js")), true);
  assertCleanArtifact(artifactRoot);

  const tools = await listTools(join(artifactRoot, "dist", "plugin-server.js"), artifactRoot);
  assertReadOnlyProfile(tools);
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
    assert.equal(parts.includes("package-lock.json"), false, `artifact must not include package-lock.json: ${relative}`);
    assert.equal(parts.includes(".env"), false, `artifact must not include .env: ${relative}`);
    assert.equal(relative.endsWith(".tgz"), false, `artifact must not include tarballs: ${relative}`);
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
