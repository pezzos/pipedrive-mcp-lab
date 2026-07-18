import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

test("packed tarball builds from a clean checkout and exposes the published bin", { timeout: 180_000 }, () => {
  const workRoot = mkdtempSync(join(tmpdir(), "pipedrive-mcp-package-smoke-"));
  const sourceCopy = join(workRoot, "source");
  const packDir = join(workRoot, "pack");
  const installDir = join(workRoot, "install");
  mkdirSync(packDir);
  mkdirSync(installDir);

  try {
    cpSync(process.cwd(), sourceCopy, {
      recursive: true,
      filter: (source) => {
        const name = basename(source);
        return ![".git", "node_modules", "dist", ".DS_Store"].includes(name) && !name.endsWith(".tgz");
      },
    });

    execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: sourceCopy, stdio: "pipe" });
    const packOutput = execFileSync("npm", ["pack", "--pack-destination", packDir, "--json"], {
      cwd: sourceCopy,
      encoding: "utf-8",
      stdio: "pipe",
    });
    const packed = JSON.parse(packOutput) as Array<{ filename: string; files: Array<{ path: string }> }>;
    const tarball = join(packDir, packed[0].filename);
    const packedFiles = packed[0].files.map((file) => file.path);
    assert.ok(packedFiles.includes("dist/server.js"));
    assert.ok(packedFiles.includes("INSTALL.md"));
    assert.ok(packedFiles.includes("INSTALL.fr.md"));
    assert.equal(packedFiles.some((file) => file.startsWith("src/")), false);
    assert.equal(packedFiles.some((file) => file.startsWith("tests/")), false);

    execFileSync("npm", ["init", "-y"], { cwd: installDir, stdio: "pipe" });
    execFileSync("npm", ["install", tarball], { cwd: installDir, stdio: "pipe" });
    const smokeOutput = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", packageSmokeScript],
      { cwd: installDir, encoding: "utf-8", stdio: "pipe" },
    );
    assert.deepEqual(JSON.parse(smokeOutput), [
      { profile: "read-only", toolCount: 47, hasMailbox: false, hasMailboxLink: false, hasDelete: false },
      { profile: "mailbox-read-only", toolCount: 53, hasMailbox: true, hasMailboxLink: false, hasDelete: false },
      { profile: "writes", toolCount: 74, hasMailbox: false, hasMailboxLink: false, hasDelete: false },
      { profile: "writes-mailbox", toolCount: 81, hasMailbox: true, hasMailboxLink: true, hasDelete: false },
      { profile: "writes-mailbox-delete", toolCount: 89, hasMailbox: true, hasMailboxLink: true, hasDelete: true },
    ]);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
});

const packageSmokeScript = `
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const profiles = [
  ["read-only", { PIPEDRIVE_ENABLE_WRITES: "false" }],
  ["mailbox-read-only", {
    PIPEDRIVE_ENABLE_WRITES: "false",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
  }],
  ["writes", { PIPEDRIVE_ENABLE_WRITES: "true" }],
  ["writes-mailbox", {
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
  }],
  ["writes-mailbox-delete", {
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
    PIPEDRIVE_ENABLE_DELETE_TOOLS: "true",
  }],
];
const results = [];
for (const [profile, flags] of profiles) {
  const client = new Client({ name: "package-smoke", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "./node_modules/.bin/pipedrive-mcp",
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      PIPEDRIVE_LOAD_DOTENV: "false",
      PIPEDRIVE_COMPANY_DOMAIN: "acme",
      PIPEDRIVE_API_TOKEN: "test-token",
      ...flags,
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  results.push({
    profile,
    toolCount: tools.length,
    hasMailbox: tools.includes("pipedrive_mailbox_probe"),
    hasMailboxLink: tools.includes("pipedrive_link_mail_thread"),
    hasDelete: tools.includes("pipedrive_delete_deal"),
  });
  await client.close();
}
console.log(JSON.stringify(results));
`;
