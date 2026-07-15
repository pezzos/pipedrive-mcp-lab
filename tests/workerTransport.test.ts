import assert from "node:assert/strict";
import test from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { build } from "esbuild";
import { handleMcpRequest } from "../src/remote/transport.js";

function createServer(): McpServer {
  const server = new McpServer({ name: "transport-test", version: "1.0.0" });
  server.registerTool(
    "ping",
    { description: "Return a test response.", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "ok" }] }),
  );
  return server;
}

function request(body: unknown): Request {
  return new Request("https://mcp.example.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
}

test("handles a stateless MCP lifecycle with a fresh server per request", async () => {
  const initialize = await handleMcpRequest(
    request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    }),
    createServer,
  );
  assert.equal(initialize.status, 200);
  assert.equal(initialize.headers.has("mcp-session-id"), false);
  const initializePayload = await initialize.json() as {
    result: { serverInfo: { name: string } };
  };
  assert.equal(initializePayload.result.serverInfo.name, "transport-test");

  const initialized = await handleMcpRequest(
    request({ jsonrpc: "2.0", method: "notifications/initialized" }),
    createServer,
  );
  assert.equal(initialized.status, 202);

  const listed = await handleMcpRequest(
    request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    createServer,
  );
  assert.equal(listed.status, 200);
  const listPayload = await listed.json() as {
    result: { tools: Array<{ name: string }> };
  };
  assert.deepEqual(listPayload.result.tools.map((tool) => tool.name), ["ping"]);

  const called = await handleMcpRequest(
    request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ping", arguments: {} },
    }),
    createServer,
  );
  assert.equal(called.status, 200);
  const callPayload = await called.json() as {
    result: { content: Array<{ type: string; text: string }> };
  };
  assert.deepEqual(callPayload.result.content, [{ type: "text", text: "ok" }]);
});

test("bundles the Worker for a browser runtime without Node built-ins", async () => {
  const result = await build({
    entryPoints: ["src/remote/worker.ts"],
    bundle: true,
    format: "esm",
    metafile: true,
    platform: "browser",
    target: "es2022",
    write: false,
  });

  const nodeInputs = Object.keys(result.metafile?.inputs ?? {}).filter((path) =>
    path.startsWith("node:"),
  );
  assert.deepEqual(nodeInputs, []);
});

test("bundles the shared tool server without pulling in Node environment loading", async () => {
  const result = await build({
    entryPoints: ["src/tools.ts"],
    bundle: true,
    format: "esm",
    metafile: true,
    platform: "browser",
    target: "es2022",
    write: false,
  });

  const inputs = Object.keys(result.metafile?.inputs ?? {});
  assert.equal(inputs.some((path) => path.includes("src/env.ts")), false);
  assert.equal(inputs.some((path) => path.includes("node:")), false);
  assert.equal(inputs.some((path) => path.includes("dotenv")), false);
});
