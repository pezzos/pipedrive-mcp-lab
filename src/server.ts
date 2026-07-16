#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { getRuntimeEnvDiagnostics, loadRuntimeEnv } from "./env.js";
import { buildServer } from "./tools.js";

loadRuntimeEnv();
const config = loadConfig();

const server = buildServer(config, undefined, {
  runtimeEnvDiagnostics: getRuntimeEnvDiagnostics,
});
const transport = new StdioServerTransport();

await server.connect(transport);
