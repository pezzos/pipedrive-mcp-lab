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
      "pipedrive_find_deals",
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
      "pipedrive_list_products",
      "pipedrive_get_product",
      "pipedrive_search_products",
      "pipedrive_list_deal_products",
      "pipedrive_list_deal_participants",
      "pipedrive_list_deal_followers",
      "pipedrive_list_deal_files",
      "pipedrive_list_deal_mail_messages",
      "pipedrive_create_deal",
      "pipedrive_update_deal",
      "pipedrive_move_deal_stage",
      "pipedrive_mark_deal_won",
      "pipedrive_mark_deal_lost",
      "pipedrive_add_product_to_deal",
      "pipedrive_add_deal_participant",
      "pipedrive_add_deal_follower",
      "pipedrive_create_person",
      "pipedrive_update_person",
      "pipedrive_create_organization",
      "pipedrive_update_organization",
      "pipedrive_create_lead",
      "pipedrive_update_lead",
      "pipedrive_convert_lead_to_deal",
      "pipedrive_create_note",
      "pipedrive_update_note",
      "pipedrive_update_activity",
      "pipedrive_mark_activity_done",
      "pipedrive_reschedule_activity",
      "pipedrive_log_call_and_schedule_follow_up",
      "pipedrive_create_activity",
      "pipedrive_delete_activity",
      "pipedrive_delete_deal",
      "pipedrive_delete_lead",
      "pipedrive_delete_note",
      "pipedrive_delete_organization",
      "pipedrive_delete_person",
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
    assert.match(liveAttemptContent[0]?.text ?? "", /Write confirmation/);

    const confirmedAttempt = await client.callTool({
      name: "pipedrive_create_activity",
      arguments: {
        subject: "MCP LAB - Follow up",
        dry_run: false,
        confirmation: "CONFIRM_WRITE",
      },
    });
    const confirmedAttemptContent = confirmedAttempt.content as Array<{ type: string; text?: string }>;
    assert.equal(confirmedAttempt.isError, true);
    assert.match(confirmedAttemptContent[0]?.text ?? "", /PIPEDRIVE_API_TOKEN/);
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
      PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
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
      PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
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
      {
        name: "pipedrive_find_deals",
        arguments: {
          term: "acme",
          fields: ["title", "notes"],
          exact_match: false,
          person_id: 11,
          organization_id: 12,
          status: "open",
          limit: 2,
          cursor: "fd1",
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
      { name: "pipedrive_list_products", arguments: { limit: 12, cursor: "prod1" } },
      { name: "pipedrive_get_product", arguments: { product_id: 40 } },
      { name: "pipedrive_search_products", arguments: { term: "service", exact_match: true, limit: 13, cursor: "ps1" } },
      { name: "pipedrive_list_deal_products", arguments: { deal_id: 123, limit: 14, cursor: "dp1" } },
      { name: "pipedrive_list_deal_participants", arguments: { deal_id: 123, limit: 15, start: 1 } },
      { name: "pipedrive_list_deal_followers", arguments: { deal_id: 123, limit: 16, cursor: "fol1" } },
      { name: "pipedrive_list_deal_files", arguments: { deal_id: 123, limit: 17, start: 2 } },
      { name: "pipedrive_list_deal_mail_messages", arguments: { deal_id: 123, limit: 18, start: 3 } },
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
    assert.ok(
      urls.includes(
        "/api/v2/deals/search?term=acme&fields=title%2Cnotes&exact_match=false&person_id=11&organization_id=12&status=open&limit=2&cursor=fd1",
      ),
    );
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
    assert.ok(urls.includes("/api/v2/products?limit=12&cursor=prod1"));
    assert.ok(urls.includes("/api/v2/products/40"));
    assert.ok(urls.includes("/api/v2/products/search?term=service&exact_match=true&limit=13&cursor=ps1"));
    assert.ok(urls.includes("/api/v2/deals/123/products?limit=14&cursor=dp1"));
    assert.ok(urls.includes("/api/v1/deals/123/participants?limit=15&start=1"));
    assert.ok(urls.includes("/api/v2/deals/123/followers?limit=16&cursor=fol1"));
    assert.ok(urls.includes("/api/v1/deals/123/files?limit=17&start=2"));
    assert.ok(urls.includes("/api/v1/deals/123/mailMessages?limit=18&start=3"));
    assert.equal(requested.every((entry) => entry.token === "test-token"), true);
    assert.equal(requested.every((entry) => !entry.url.includes("test-token")), true);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("commercial write tools require confirmation and send expected methods when enabled", async () => {
  const requested: Array<{ method: string; url: string; body: unknown; token: string }> = [];
  const api = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) {
      text += chunk.toString();
    }
    requested.push({
      method: request.method ?? "",
      url: request.url ?? "",
      body: text ? JSON.parse(text) : null,
      token: request.headers["x-api-token"]?.toString() ?? "",
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, data: { id: 999 } }));
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
      PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
      PIPEDRIVE_API_TOKEN: "test-token",
      PIPEDRIVE_ENABLE_WRITES: "true",
      PIPEDRIVE_WRITE_CONFIRMATION: "YES_WRITE",
      PIPEDRIVE_REQUIRE_LAB_PREFIX: "false",
    },
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const dryRun = await client.callTool({
      name: "pipedrive_create_deal",
      arguments: {
        title: "New deal",
        value: 1000,
        currency: "EUR",
        custom_fields: { custom_hash: "source" },
        dry_run: true,
      },
    });
    assert.equal(requested.length, 0);
    assert.match((dryRun.content as Array<{ text?: string }>)[0]?.text ?? "", /"dry_run": true/);

    const rejected = await client.callTool({
      name: "pipedrive_update_deal",
      arguments: {
        deal_id: 123,
        stage_id: 5,
        dry_run: false,
        confirmation: "WRONG",
      },
    });
    assert.equal(rejected.isError, true);
    assert.equal(requested.length, 0);

    const invalidLead = await client.callTool({
      name: "pipedrive_create_lead",
      arguments: {
        title: "Unlinked lead",
        dry_run: true,
      },
    });
    assert.equal(invalidLead.isError, true);
    assert.match((invalidLead.content as Array<{ text?: string }>)[0]?.text ?? "", /person_id or organization_id/);
    assert.equal(requested.length, 0);

    const leadId = "11111111-1111-4111-8111-111111111111";
    const realCalls = [
      {
        name: "pipedrive_create_activity",
        arguments: { subject: "Activity", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_create_deal",
        arguments: { title: "New deal", person_id: 11, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_update_deal",
        arguments: { deal_id: 123, stage_id: 5, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_move_deal_stage",
        arguments: { deal_id: 124, stage_id: 6, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_mark_deal_won",
        arguments: { deal_id: 125, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_mark_deal_lost",
        arguments: { deal_id: 126, lost_reason: "No budget", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_add_product_to_deal",
        arguments: {
          deal_id: 127,
          product_id: 40,
          item_price: 250,
          quantity: 2,
          dry_run: false,
          confirmation: "YES_WRITE",
        },
      },
      {
        name: "pipedrive_add_deal_participant",
        arguments: { deal_id: 128, person_id: 11, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_add_deal_follower",
        arguments: { deal_id: 129, user_id: 7, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_create_person",
        arguments: { name: "Ada Lovelace", email: "ada@example.com", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_update_person",
        arguments: { person_id: 11, phone: "+33123456789", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_create_organization",
        arguments: { name: "Acme", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_update_organization",
        arguments: { organization_id: 12, address: "Paris", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_create_lead",
        arguments: { title: "Qualified lead", person_id: 11, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_update_lead",
        arguments: { lead_id: leadId, title: "Updated lead", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_create_note",
        arguments: { content: "Discovery note", deal_id: 123, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_update_note",
        arguments: { note_id: 10, content: "Updated note", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_convert_lead_to_deal",
        arguments: {
          lead_id: leadId,
          stage_id: 5,
          dry_run: false,
          confirmation: "YES_WRITE",
        },
      },
      {
        name: "pipedrive_update_activity",
        arguments: { activity_id: 20, subject: "Updated activity", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_mark_activity_done",
        arguments: { activity_id: 21, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_reschedule_activity",
        arguments: { activity_id: 22, due_date: "2026-05-25", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_log_call_and_schedule_follow_up",
        arguments: {
          call_subject: "Call done",
          follow_up_subject: "Follow up",
          deal_id: 123,
          follow_up_due_date: "2026-05-24",
          dry_run: false,
          confirmation: "YES_WRITE",
        },
      },
      {
        name: "pipedrive_delete_activity",
        arguments: { activity_id: 20, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_delete_deal",
        arguments: { deal_id: 123, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_delete_lead",
        arguments: { lead_id: leadId, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_delete_note",
        arguments: { note_id: 10, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_delete_organization",
        arguments: { organization_id: 12, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_delete_person",
        arguments: { person_id: 11, dry_run: false, confirmation: "YES_WRITE" },
      },
    ];

    for (const call of realCalls) {
      const result = await client.callTool(call);
      assert.equal(result.isError, undefined);
    }

    assert.deepEqual(
      requested.map((entry) => `${entry.method} ${entry.url}`),
      [
        "POST /api/v2/activities",
        "POST /api/v2/deals",
        "PATCH /api/v2/deals/123",
        "PATCH /api/v2/deals/124",
        "PATCH /api/v2/deals/125",
        "PATCH /api/v2/deals/126",
        "POST /api/v2/deals/127/products",
        "POST /api/v1/deals/128/participants",
        "POST /api/v2/deals/129/followers",
        "POST /api/v2/persons",
        "PATCH /api/v2/persons/11",
        "POST /api/v2/organizations",
        "PATCH /api/v2/organizations/12",
        "POST /api/v1/leads",
        `PATCH /api/v1/leads/${leadId}`,
        "POST /api/v1/notes",
        "PUT /api/v1/notes/10",
        `POST /api/v2/leads/${leadId}/convert/deal`,
        "PATCH /api/v2/activities/20",
        "PATCH /api/v2/activities/21",
        "PATCH /api/v2/activities/22",
        "POST /api/v2/activities",
        "POST /api/v2/activities",
        "DELETE /api/v2/activities/20",
        "DELETE /api/v2/deals/123",
        `DELETE /api/v1/leads/${leadId}`,
        "DELETE /api/v1/notes/10",
        "DELETE /api/v2/organizations/12",
        "DELETE /api/v2/persons/11",
      ],
    );
    assert.equal(requested.every((entry) => entry.token === "test-token"), true);
    assert.equal(requested.every((entry) => !entry.url.includes("test-token")), true);
    assert.deepEqual(requested[2]?.body, { stage_id: 5 });
    assert.deepEqual(requested[4]?.body, { status: "won" });
    assert.deepEqual(requested[6]?.body, { product_id: 40, item_price: 250, quantity: 2 });
    assert.deepEqual(requested[7]?.body, { person_id: 11 });
    assert.deepEqual(requested[8]?.body, { user_id: 7 });
    assert.deepEqual(requested[13]?.body, { title: "Qualified lead", person_id: 11 });
    assert.deepEqual(requested[15]?.body, { content: "Discovery note", deal_id: 123 });
    assert.deepEqual(requested[16]?.body, { content: "Updated note" });
    assert.deepEqual(requested[17]?.body, { stage_id: 5 });
    assert.equal((requested[19]?.body as { done?: boolean }).done, true);
    assert.equal((requested[20]?.body as { due_date?: string }).due_date, "2026-05-25");
    assert.equal((requested[21]?.body as { done?: boolean }).done, true);
    assert.equal((requested[22]?.body as { due_date?: string }).due_date, "2026-05-24");
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("real writes require lab-scoped targets and dry-run can validate linked records", async () => {
  const requested: Array<{ method: string; url: string; body: unknown; token: string }> = [];
  const api = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) {
      text += chunk.toString();
    }
    requested.push({
      method: request.method ?? "",
      url: request.url ?? "",
      body: text ? JSON.parse(text) : null,
      token: request.headers["x-api-token"]?.toString() ?? "",
    });

    const url = request.url ?? "";
    if (request.method === "GET" && url === "/api/v2/persons/11") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 11, name: "MCP LAB - Ada" } }));
      return;
    }
    if (request.method === "GET" && url === "/api/v2/deals/123") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 123, title: "Real customer deal" } }));
      return;
    }
    if (request.method === "GET" && url === "/api/v2/deals/124") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 124, title: "MCP LAB - Safe deal" } }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, data: { id: 999 } }));
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
      PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
      PIPEDRIVE_API_TOKEN: "test-token",
      PIPEDRIVE_ENABLE_WRITES: "true",
      PIPEDRIVE_WRITE_CONFIRMATION: "YES_WRITE",
    },
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const dryRun = await client.callTool({
      name: "pipedrive_create_person",
      arguments: {
        name: "MCP LAB - Ada",
        email: "ada@example.com",
        phone: "+33123456789",
        dry_run: true,
      },
    });
    const dryRunText = (dryRun.content as Array<{ text?: string }>)[0]?.text ?? "";
    assert.match(dryRunText, /"email": "\[redacted\]"/);
    assert.match(dryRunText, /"phone": "\[redacted\]"/);
    assert.equal(requested.length, 0);

    const validatedDryRun = await client.callTool({
      name: "pipedrive_create_deal",
      arguments: {
        title: "MCP LAB - Validated dry run",
        person_id: 11,
        validate_links: true,
        dry_run: true,
      },
    });
    assert.equal(validatedDryRun.isError, undefined);
    assert.match((validatedDryRun.content as Array<{ text?: string }>)[0]?.text ?? "", /"validated_links": \[\s*"person:11"/);
    assert.deepEqual(
      requested.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/persons/11"],
    );

    const unsafeCreate = await client.callTool({
      name: "pipedrive_create_deal",
      arguments: {
        title: "Real customer deal",
        dry_run: false,
        confirmation: "YES_WRITE",
      },
    });
    assert.equal(unsafeCreate.isError, true);
    assert.match((unsafeCreate.content as Array<{ text?: string }>)[0]?.text ?? "", /MCP LAB -/);
    assert.equal(requested.length, 1);

    const unsafeUpdate = await client.callTool({
      name: "pipedrive_update_deal",
      arguments: {
        deal_id: 123,
        stage_id: 5,
        dry_run: false,
        confirmation: "YES_WRITE",
      },
    });
    assert.equal(unsafeUpdate.isError, true);
    assert.equal(requested.at(-1)?.url, "/api/v2/deals/123");

    const safeUpdate = await client.callTool({
      name: "pipedrive_update_deal",
      arguments: {
        deal_id: 124,
        stage_id: 6,
        dry_run: false,
        confirm_lab_write: true,
      },
    });
    assert.equal(safeUpdate.isError, undefined);
    assert.deepEqual(
      requested.slice(-2).map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/deals/124", "PATCH /api/v2/deals/124"],
    );
    assert.deepEqual(requested.at(-1)?.body, { stage_id: 6 });

    const safeDelete = await client.callTool({
      name: "pipedrive_delete_deal",
      arguments: {
        deal_id: 124,
        dry_run: false,
        confirm_lab_write: true,
      },
    });
    assert.equal(safeDelete.isError, undefined);
    assert.deepEqual(
      requested.slice(-2).map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/deals/124", "DELETE /api/v2/deals/124"],
    );
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});
