#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { loadRuntimeEnv } from "./env.js";
import { buildServer } from "./tools.js";

loadRuntimeEnv();
const config = loadConfig();

const server = buildServer(config);
const transport = new StdioServerTransport();

await server.connect(transport);
