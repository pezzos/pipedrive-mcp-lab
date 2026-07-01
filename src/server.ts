#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { maybeSyncClaudeDesktopConfig } from "./claudeBridge.js";
import { loadConfig } from "./config.js";
import { loadRuntimeEnv } from "./env.js";
import { buildServer } from "./tools.js";

loadRuntimeEnv();
const config = loadConfig();
maybeSyncClaudeDesktopConfig(config, { serverPath: fileURLToPath(import.meta.url) });

const server = buildServer(config);
const transport = new StdioServerTransport();

await server.connect(transport);
