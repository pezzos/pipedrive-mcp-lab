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
    for (const expected of [
      "pipedrive_health_check",
      "pipedrive_search_items",
      "pipedrive_list_persons",
      "pipedrive_get_person",
      "pipedrive_list_organizations",
      "pipedrive_get_organization",
      "pipedrive_list_leads",
      "pipedrive_get_lead",
      "pipedrive_list_stages",
      "pipedrive_get_pipeline",
      "pipedrive_list_activity_types",
      "pipedrive_get_current_user",
      "pipedrive_list_users",
      "pipedrive_list_notes",
      "pipedrive_get_note",
      "pipedrive_list_deal_fields",
      "pipedrive_list_person_fields",
      "pipedrive_list_organization_fields",
      "pipedrive_create_activity",
    ]) {
      assert.ok(toolNames.includes(expected), `missing ${expected}`);
    }
    const createActivity = listed.tools.find((tool) => tool.name === "pipedrive_create_activity");
    const searchItems = listed.tools.find((tool) => tool.name === "pipedrive_search_items");
    assert.equal(createActivity?.annotations?.readOnlyHint, false);
    assert.equal(searchItems?.annotations?.readOnlyHint, true);

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
        cursor: "next-page",
      },
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.match(content[0]?.text ?? "", /Mock deal/);
    assert.match(requestedUrl, /\/api\/v2\/deals/);
    assert.match(requestedUrl, /status=open/);
    assert.match(requestedUrl, /cursor=next-page/);
    assert.doesNotMatch(requestedUrl, /test-token/);
    assert.equal(requestedToken, "test-token");
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("expanded read-only tools call expected Pipedrive endpoints and forward filters", async () => {
  const requested: Array<{ url: string; token: string }> = [];
  const api = createServer((request, response) => {
    requested.push({
      url: request.url ?? "",
      token: request.headers["x-api-token"]?.toString() ?? "",
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, data: [], additional_data: {} }));
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
    const leadId = "11111111-1111-4111-8111-111111111111";
    const calls = [
      {
        name: "pipedrive_search_items",
        arguments: {
          term: "acme",
          item_types: ["deal", "person"],
          limit: 2,
          cursor: "c1",
          exact_match: true,
        },
      },
      { name: "pipedrive_list_persons", arguments: { owner_id: 7, limit: 3, cursor: "p1" } },
      { name: "pipedrive_get_person", arguments: { person_id: 11 } },
      { name: "pipedrive_list_organizations", arguments: { limit: 4, cursor: "o1" } },
      { name: "pipedrive_get_organization", arguments: { organization_id: 12 } },
      {
        name: "pipedrive_list_leads",
        arguments: { organization_id: 12, limit: 5, start: 10 },
      },
      { name: "pipedrive_get_lead", arguments: { lead_id: leadId } },
      { name: "pipedrive_list_pipelines", arguments: { limit: 6, cursor: "pipe1" } },
      { name: "pipedrive_list_stages", arguments: { pipeline_id: 2, limit: 6, cursor: "s1" } },
      { name: "pipedrive_get_pipeline", arguments: { pipeline_id: 1 } },
      {
        name: "pipedrive_list_activities",
        arguments: {
          deal_id: 123,
          done: false,
          updated_since: "2026-05-01T00:00:00Z",
          limit: 7,
          cursor: "a1",
        },
      },
      { name: "pipedrive_get_activity", arguments: { activity_id: 20 } },
      { name: "pipedrive_list_activity_types", arguments: {} },
      { name: "pipedrive_get_current_user", arguments: {} },
      { name: "pipedrive_list_users", arguments: {} },
      { name: "pipedrive_list_notes", arguments: { deal_id: 123, limit: 8, start: 0 } },
      { name: "pipedrive_get_note", arguments: { note_id: 30 } },
      { name: "pipedrive_list_deal_fields", arguments: { limit: 9, cursor: "df1" } },
      { name: "pipedrive_list_person_fields", arguments: { limit: 10, cursor: "pf1" } },
      { name: "pipedrive_list_organization_fields", arguments: { limit: 11, cursor: "of1" } },
    ];

    for (const call of calls) {
      const result = await client.callTool(call);
      assert.equal(result.isError, undefined);
    }

    const urls = requested.map((entry) => entry.url);
    assert.ok(
      urls.includes(
        "/api/v2/itemSearch?term=acme&item_types=deal%2Cperson&limit=2&cursor=c1&exact_match=true",
      ),
    );
    const searchUrl = new URL(urls[0] ?? "", "http://127.0.0.1");
    assert.equal(searchUrl.searchParams.get("item_types"), "deal,person");
    assert.equal(searchUrl.searchParams.get("exact_match"), "true");
    assert.ok(urls.includes("/api/v2/persons?owner_id=7&limit=3&cursor=p1"));
    assert.ok(urls.includes("/api/v2/persons/11"));
    assert.ok(urls.includes("/api/v2/organizations?limit=4&cursor=o1"));
    assert.ok(urls.includes("/api/v2/organizations/12"));
    assert.ok(urls.includes("/api/v1/leads?limit=5&start=10&org_id=12"));
    assert.ok(urls.includes(`/api/v1/leads/${leadId}`));
    assert.ok(urls.includes("/api/v2/pipelines?limit=6&cursor=pipe1"));
    assert.ok(urls.includes("/api/v2/stages?pipeline_id=2&limit=6&cursor=s1"));
    assert.ok(urls.includes("/api/v2/pipelines/1"));
    assert.ok(
      urls.includes(
        "/api/v2/activities?deal_id=123&done=false&updated_since=2026-05-01T00%3A00%3A00Z&limit=7&cursor=a1",
      ),
    );
    assert.ok(urls.includes("/api/v2/activities/20"));
    assert.ok(urls.includes("/api/v1/activityTypes"));
    assert.ok(urls.includes("/api/v1/users/me"));
    assert.ok(urls.includes("/api/v1/users"));
    assert.ok(urls.includes("/api/v1/notes?deal_id=123&limit=8&start=0"));
    assert.ok(urls.includes("/api/v1/notes/30"));
    assert.ok(urls.includes("/api/v2/dealFields?limit=9&cursor=df1"));
    assert.ok(urls.includes("/api/v2/personFields?limit=10&cursor=pf1"));
    assert.ok(urls.includes("/api/v2/organizationFields?limit=11&cursor=of1"));
    assert.equal(requested.every((entry) => entry.token === "test-token"), true);
    assert.equal(requested.every((entry) => !entry.url.includes("test-token")), true);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});
