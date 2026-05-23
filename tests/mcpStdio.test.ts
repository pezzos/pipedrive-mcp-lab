import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("starts over stdio, lists tools, and dry-runs the write tool", async () => {
  const client = new Client({ name: "pipedrive-mcp-lab-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      PIPEDRIVE_COMPANY_DOMAIN: "acme",
      PIPEDRIVE_API_TOKEN: "test-token",
      PIPEDRIVE_ENABLE_WRITES: "false",
    },
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("pipedrive_health_check"));
    assert.ok(toolNames.includes("pipedrive_create_activity"));

    const result = await client.callTool({
      name: "pipedrive_create_activity",
      arguments: {
        subject: "Follow up",
        dry_run: true,
      },
    });

    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content[0]?.type === "text" ? (content[0].text ?? "") : "";
    assert.match(text, /"dry_run": true/);
    assert.match(text, /"writes_enabled": false/);
  } finally {
    await client.close();
  }
});

test("dry-run works without token and live write fails clearly without token", async () => {
  const client = new Client({ name: "pipedrive-mcp-lab-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      PIPEDRIVE_COMPANY_DOMAIN: "acme",
      PIPEDRIVE_ENABLE_WRITES: "true",
    },
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const dryRun = await client.callTool({
      name: "pipedrive_create_activity",
      arguments: {
        subject: "Follow up",
        dry_run: true,
      },
    });
    const dryRunContent = dryRun.content as Array<{ type: string; text?: string }>;
    assert.match(dryRunContent[0]?.text ?? "", /"dry_run": true/);

    const liveAttempt = await client.callTool({
      name: "pipedrive_create_activity",
      arguments: {
        subject: "Follow up",
        dry_run: false,
      },
    });
    const liveAttemptContent = liveAttempt.content as Array<{ type: string; text?: string }>;
    assert.equal(liveAttempt.isError, true);
    assert.match(liveAttemptContent[0]?.text ?? "", /PIPEDRIVE_API_TOKEN/);
  } finally {
    await client.close();
  }
});

test("read tool calls mocked Pipedrive API over stdio without token in URL", async () => {
  let requestedUrl = "";
  let requestedToken = "";
  const api = createServer((request, response) => {
    requestedUrl = request.url ?? "";
    requestedToken = request.headers["x-api-token"]?.toString() ?? "";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, data: [{ id: 123, title: "Mock deal" }] }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const { port } = api.address() as AddressInfo;

  const client = new Client({ name: "pipedrive-mcp-lab-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      PIPEDRIVE_BASE_URL: `http://127.0.0.1:${port}`,
      PIPEDRIVE_API_TOKEN: "test-token",
      PIPEDRIVE_ENABLE_WRITES: "false",
    },
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "pipedrive_list_deals",
      arguments: {
        status: "open",
        limit: 1,
      },
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.match(content[0]?.text ?? "", /Mock deal/);
    assert.match(requestedUrl, /\/api\/v2\/deals/);
    assert.match(requestedUrl, /status=open/);
    assert.doesNotMatch(requestedUrl, /test-token/);
    assert.equal(requestedToken, "test-token");
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});
