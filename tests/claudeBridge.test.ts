import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { maybeSyncClaudeDesktopConfig } from "../src/claudeBridge.js";
import type { PipedriveConfig } from "../src/config.js";

const extensionServerPath = join(
  "Library",
  "Application Support",
  "Claude",
  "Claude Extensions",
  "local.mcpb.pezzoslabs.pipedrive-mcp",
  "server",
  "plugin-server.js",
);

test("does not sync Claude Desktop config outside a Desktop Extension path", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const didSync = maybeSyncClaudeDesktopConfig(config(), {
      env: {},
      homeDir: home,
      platform: "darwin",
      serverPath: join(home, "repo", "dist", "plugin-server.js"),
      execPath: "/usr/local/bin/node",
    });

    assert.equal(didSync, false);
    assert.equal(existsSync(claudeConfigPath(home)), false);
  } finally {
    cleanup();
  }
});

test("does not sync Claude Desktop config before credentials are complete", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const didSync = maybeSyncClaudeDesktopConfig(config({ apiToken: undefined }), {
      env: {},
      homeDir: home,
      platform: "darwin",
      serverPath: join(home, extensionServerPath),
      execPath: "/usr/local/bin/node",
    });

    assert.equal(didSync, false);
    assert.equal(existsSync(claudeConfigPath(home)), false);
  } finally {
    cleanup();
  }
});

test("writes a managed Claude Desktop MCP server from Desktop Extension settings", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const path = claudeConfigPath(home);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        other: true,
        mcpServers: {
          unrelated: { command: "node", args: ["server.js"] },
        },
      }),
      "utf8",
    );

    const didSync = maybeSyncClaudeDesktopConfig(config(), {
      env: {},
      homeDir: home,
      platform: "darwin",
      serverPath: join(home, extensionServerPath),
      execPath: "/usr/local/bin/node",
    });

    assert.equal(didSync, true);
    const written = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(written.other, true);
    assert.deepEqual(written.mcpServers.unrelated, { command: "node", args: ["server.js"] });
    assert.equal(written.mcpServers.pipedrive.command, "/usr/local/bin/node");
    assert.deepEqual(written.mcpServers.pipedrive.args, [join(home, extensionServerPath)]);
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_LOAD_DOTENV, "false");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_COMPANY_DOMAIN, "acme");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_API_TOKEN, "api-token");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_ACCESS_TOKEN, "");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_ENABLE_WRITES, "true");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_ENABLE_MAILBOX_TOOLS, "true");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_ENABLE_DELETE_TOOLS, "false");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_REQUEST_TIMEOUT_MS, "10000");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_SYNC_CLAUDE_DESKTOP_CONFIG, "false");
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_MANAGED_BY_PIPEDRIVE_MCP_EXTENSION, "true");
    if (process.platform !== "win32") {
      assert.equal(statSync(path).mode & 0o777, 0o600);
    }
  } finally {
    cleanup();
  }
});

test("uses a fallback server name when pipedrive is user-managed", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const path = claudeConfigPath(home);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          pipedrive: { command: "node", args: ["/manual/server.js"], env: { PIPEDRIVE_API_TOKEN: "manual" } },
        },
      }),
      "utf8",
    );

    const didSync = withSuppressedConsoleError(() =>
      maybeSyncClaudeDesktopConfig(config(), {
        env: {},
        homeDir: home,
        platform: "darwin",
        serverPath: join(home, extensionServerPath),
        execPath: "/usr/local/bin/node",
      }),
    );

    assert.equal(didSync, true);
    const written = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(written.mcpServers.pipedrive.command, "node");
    assert.equal(written.mcpServers["pipedrive-mcp"].env.PIPEDRIVE_MANAGED_BY_PIPEDRIVE_MCP_EXTENSION, "true");
  } finally {
    cleanup();
  }
});

test("does not overwrite fallback when both common server names are user-managed", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const path = claudeConfigPath(home);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          pipedrive: { command: "node", args: ["/manual/pipedrive.js"] },
          "pipedrive-mcp": { command: "node", args: ["/manual/pipedrive-mcp.js"] },
        },
      }),
      "utf8",
    );

    const didSync = withSuppressedConsoleError(() =>
      maybeSyncClaudeDesktopConfig(config(), {
        env: {},
        homeDir: home,
        platform: "darwin",
        serverPath: join(home, extensionServerPath),
        execPath: "/usr/local/bin/node",
      }),
    );

    assert.equal(didSync, false);
    const written = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(written.mcpServers.pipedrive, { command: "node", args: ["/manual/pipedrive.js"] });
    assert.deepEqual(written.mcpServers["pipedrive-mcp"], { command: "node", args: ["/manual/pipedrive-mcp.js"] });
  } finally {
    cleanup();
  }
});

test("updates an existing managed server when extension settings change", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const path = claudeConfigPath(home);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          pipedrive: {
            command: "/usr/local/bin/node",
            args: [join(home, extensionServerPath)],
            env: {
              PIPEDRIVE_API_TOKEN: "old-token",
              PIPEDRIVE_MANAGED_BY_PIPEDRIVE_MCP_EXTENSION: "true",
            },
          },
        },
      }),
      "utf8",
    );

    const didSync = maybeSyncClaudeDesktopConfig(config({ apiToken: "new-token" }), {
      env: {},
      homeDir: home,
      platform: "darwin",
      serverPath: join(home, extensionServerPath),
      execPath: "/usr/local/bin/node",
    });

    assert.equal(didSync, true);
    const written = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(written.mcpServers.pipedrive.env.PIPEDRIVE_API_TOKEN, "new-token");
    assert.equal(written.mcpServers["pipedrive-mcp"], undefined);
  } finally {
    cleanup();
  }
});

test("rejects non-object mcpServers values without rewriting config", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const path = claudeConfigPath(home);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify({ mcpServers: [] }), "utf8");

    const didSync = withSuppressedConsoleError(() =>
      maybeSyncClaudeDesktopConfig(config(), {
        env: {},
        homeDir: home,
        platform: "darwin",
        serverPath: join(home, extensionServerPath),
        execPath: "/usr/local/bin/node",
      }),
    );

    assert.equal(didSync, false);
    assert.equal(readFileSync(path, "utf8"), JSON.stringify({ mcpServers: [] }));
  } finally {
    cleanup();
  }
});

test("respects the bridge disable flag", () => {
  const { home, cleanup } = temporaryHome();
  try {
    const didSync = maybeSyncClaudeDesktopConfig(config(), {
      env: { PIPEDRIVE_SYNC_CLAUDE_DESKTOP_CONFIG: "false" },
      homeDir: home,
      platform: "darwin",
      serverPath: join(home, extensionServerPath),
      execPath: "/usr/local/bin/node",
    });

    assert.equal(didSync, false);
    assert.equal(existsSync(claudeConfigPath(home)), false);
  } finally {
    cleanup();
  }
});

function config(overrides: Partial<PipedriveConfig> = {}): PipedriveConfig {
  return {
    apiToken: "api-token",
    accessToken: undefined,
    companyDomain: "acme",
    baseUrl: "https://acme.pipedrive.com",
    allowMockBaseUrl: false,
    enableWrites: true,
    enableDeleteTools: false,
    enableMailboxTools: true,
    requestTimeoutMs: 10000,
    ...overrides,
  };
}

function temporaryHome() {
  const home = mkdtempSync(join(tmpdir(), "pipedrive-claude-bridge-"));
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

function claudeConfigPath(home: string): string {
  return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

function withSuppressedConsoleError<T>(callback: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return callback();
  } finally {
    console.error = original;
  }
}
