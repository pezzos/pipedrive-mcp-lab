import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { PipedriveConfig } from "./config.js";

type ClaudeDesktopConfig = {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

type SyncOptions = {
  env?: NodeJS.ProcessEnv;
  serverPath?: string;
  execPath?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
};

const managedEnvFlag = "PIPEDRIVE_MANAGED_BY_PIPEDRIVE_MCP_EXTENSION";

/**
 * Claude Cowork currently sees local MCP servers from Claude Desktop's shared
 * MCP config, while Desktop Extensions own the editable credential UI. This
 * bridge copies extension settings into a managed MCP entry after installation.
 */
export function maybeSyncClaudeDesktopConfig(config: PipedriveConfig, options: SyncOptions = {}): boolean {
  const env = options.env ?? process.env;
  const serverPath = options.serverPath ?? fileURLToPath(import.meta.url);

  if (env.PIPEDRIVE_SYNC_CLAUDE_DESKTOP_CONFIG === "false") {
    return false;
  }
  if (!isClaudeDesktopExtensionServerPath(serverPath)) {
    return false;
  }
  if (!hasMinimumBridgeConfig(config, env)) {
    return false;
  }

  const configPath = claudeDesktopConfigPath(options);
  if (!configPath) {
    return false;
  }

  try {
    mkdirSync(dirname(configPath), { recursive: true });
    const existing = readClaudeDesktopConfig(configPath);
    const serverName = chooseServerName(existing, env.PIPEDRIVE_CLAUDE_MCP_SERVER_NAME);
    const managedServer = buildManagedServerConfig(config, env, serverPath, options.execPath ?? process.execPath);
    if (isSameConfig(existing.mcpServers?.[serverName], managedServer)) {
      return true;
    }
    existing.mcpServers = {
      ...(existing.mcpServers ?? {}),
      [serverName]: managedServer,
    };
    writeClaudeDesktopConfig(configPath, existing);
    return true;
  } catch (error) {
    console.error(`Failed to sync Claude Desktop MCP config: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function claudeDesktopConfigPath(options: SyncOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? env.HOME ?? env.USERPROFILE;
  if (!home) {
    return undefined;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  const configHome = env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(configHome, "Claude", "claude_desktop_config.json");
}

function isClaudeDesktopExtensionServerPath(serverPath: string): boolean {
  const normalized = normalize(serverPath);
  return normalized.includes(normalize("Claude Extensions")) && normalized.includes("local.mcpb.");
}

function hasMinimumBridgeConfig(config: PipedriveConfig, env: NodeJS.ProcessEnv): boolean {
  const hasToken = Boolean(config.apiToken || config.accessToken);
  const hasBase = Boolean(config.companyDomain || clean(env.PIPEDRIVE_BASE_URL));
  return hasToken && hasBase;
}

function readClaudeDesktopConfig(configPath: string): ClaudeDesktopConfig {
  if (!existsSync(configPath)) {
    return {};
  }
  const text = readFileSync(configPath, "utf8").trim();
  if (!text) {
    return {};
  }
  const parsed = JSON.parse(text) as ClaudeDesktopConfig;
  if (parsed.mcpServers && (typeof parsed.mcpServers !== "object" || Array.isArray(parsed.mcpServers))) {
    throw new Error("claude_desktop_config.json has a non-object mcpServers field");
  }
  return parsed;
}

function chooseServerName(config: ClaudeDesktopConfig, requestedName?: string): string {
  const preferred = clean(requestedName) ?? "pipedrive";
  const existing = config.mcpServers?.[preferred];
  if (!existing || isManagedServer(existing)) {
    return preferred;
  }
  const fallback = preferred === "pipedrive-mcp" ? "pipedrive-mcp-extension" : "pipedrive-mcp";
  const fallbackExisting = config.mcpServers?.[fallback];
  if (!fallbackExisting || isManagedServer(fallbackExisting)) {
    return fallback;
  }
  throw new Error(`Claude Desktop MCP config already has user-managed '${preferred}' and '${fallback}' servers`);
}

function isManagedServer(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const env = (value as { env?: unknown }).env;
  return Boolean(env && typeof env === "object" && (env as Record<string, unknown>)[managedEnvFlag] === "true");
}

function buildManagedServerConfig(config: PipedriveConfig, env: NodeJS.ProcessEnv, serverPath: string, execPath: string) {
  return {
    command: execPath,
    args: [serverPath],
    env: {
      PIPEDRIVE_LOAD_DOTENV: "false",
      PIPEDRIVE_COMPANY_DOMAIN: config.companyDomain ?? "",
      PIPEDRIVE_BASE_URL: clean(env.PIPEDRIVE_BASE_URL) ?? "",
      PIPEDRIVE_API_TOKEN: config.apiToken ?? "",
      PIPEDRIVE_ACCESS_TOKEN: config.accessToken ?? "",
      PIPEDRIVE_ENABLE_WRITES: String(config.enableWrites),
      PIPEDRIVE_ENABLE_MAILBOX_TOOLS: String(config.enableMailboxTools),
      PIPEDRIVE_ENABLE_DELETE_TOOLS: String(config.enableDeleteTools),
      PIPEDRIVE_REQUEST_TIMEOUT_MS: String(config.requestTimeoutMs),
      PIPEDRIVE_SYNC_CLAUDE_DESKTOP_CONFIG: "false",
      [managedEnvFlag]: "true",
    },
  };
}

function isSameConfig(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeClaudeDesktopConfig(configPath: string, config: ClaudeDesktopConfig): void {
  const tempPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, configPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
