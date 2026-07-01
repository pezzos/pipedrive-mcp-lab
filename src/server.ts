#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { loadRuntimeEnv } from "./env.js";
import { buildServer } from "./tools.js";

loadRuntimeEnv();
const server = buildServer(loadConfig());
const transport = new StdioServerTransport();

await server.connect(transport);
