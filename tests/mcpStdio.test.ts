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
      PIPEDRIVE_LOAD_DOTENV: "false",
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
      "pipedrive_mailbox_probe",
      "pipedrive_list_mail_threads",
      "pipedrive_get_mail_thread",
      "pipedrive_list_mail_thread_messages",
      "pipedrive_get_mail_message",
      "pipedrive_link_mail_thread",
      "pipedrive_list_project_boards",
      "pipedrive_get_project_board",
      "pipedrive_list_project_phases",
      "pipedrive_get_project_phase",
      "pipedrive_list_project_templates",
      "pipedrive_get_project_template",
      "pipedrive_list_project_fields",
      "pipedrive_get_project_field",
      "pipedrive_list_projects",
      "pipedrive_get_project",
      "pipedrive_search_projects",
      "pipedrive_list_archived_projects",
      "pipedrive_list_tasks",
      "pipedrive_get_task",
      "pipedrive_create_project",
      "pipedrive_update_project",
      "pipedrive_archive_project",
      "pipedrive_delete_project",
      "pipedrive_create_task",
      "pipedrive_update_task",
      "pipedrive_delete_task",
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
    const linkMailThread = listed.tools.find((tool) => tool.name === "pipedrive_link_mail_thread");
    const createProject = listed.tools.find((tool) => tool.name === "pipedrive_create_project");
    const createTask = listed.tools.find((tool) => tool.name === "pipedrive_create_task");
    const updateTask = listed.tools.find((tool) => tool.name === "pipedrive_update_task");
    assert.equal(createActivity?.annotations?.readOnlyHint, false);
    assert.equal(searchItems?.annotations?.readOnlyHint, true);
    assert.equal(linkMailThread?.annotations?.readOnlyHint, false);
    assert.match(JSON.stringify(linkMailThread?.inputSchema ?? {}), /confirm_lab_write/);
    assert.match(createProject?.description ?? "", /before creating project tasks/);
    assert.match(createTask?.description ?? "", /Requires project_id/);
    assert.match(createTask?.description ?? "", /Do not pass board_id or phase_id/);
    assert.match(updateTask?.description ?? "", /not a board or phase/);
    assert.match(JSON.stringify(createTask?.inputSchema ?? {}), /Existing parent project id/);
    assert.match(JSON.stringify(createTask?.inputSchema ?? {}), /not board_id or phase_id/);
    assert.match(JSON.stringify(updateTask?.inputSchema ?? {}), /use pipedrive_update_project/);
    assert.doesNotMatch(toolNames.join(","), /draft|send|reply|delete_mail_thread/);
    assert.doesNotMatch(JSON.stringify(linkMailThread?.inputSchema ?? {}), /shared_flag|read_flag|archived_flag/);

    const health = await client.callTool({ name: "pipedrive_health_check", arguments: {} });
    const healthContent = health.content as Array<{ type: string; text?: string }>;
    const healthJson = JSON.parse(healthContent[0]?.text ?? "{}");
    assert.equal(healthJson.runtime_env_diagnostics_initialized, true);
    assert.equal(healthJson.dotenv_loading_enabled, false);
    assert.equal(healthJson.dotenv_local_file_present, false);
    assert.equal(typeof healthJson.dotenv_parent_file_present, "boolean");
    assert.equal(healthJson.dotenv_loaded, false);
    assert.equal(healthJson.runtime_env_preexisting_enable_writes, true);
    assert.equal(healthJson.runtime_env_preexisting_require_lab_prefix, false);
    assert.equal(healthJson.runtime_env_preexisting_require_write_confirmation, false);
    assert.equal(healthJson.runtime_env_preexisting_load_dotenv, true);
    assert.equal(healthJson.runtime_env_current_has_enable_writes, true);
    assert.equal(healthJson.runtime_env_current_has_require_lab_prefix, false);
    assert.equal(healthJson.runtime_env_current_has_require_write_confirmation, false);
    assert.equal(healthJson.runtime_env_current_has_load_dotenv, true);
    assert.equal(JSON.stringify(healthJson).includes("test-token"), false);

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
      PIPEDRIVE_LOAD_DOTENV: "false",
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

test("production mode can write without shared confirmation", async () => {
  const client = new Client({ name: "pipedrive-mcp-lab-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      PIPEDRIVE_LOAD_DOTENV: "false",
      PIPEDRIVE_COMPANY_DOMAIN: "acme",
      PIPEDRIVE_ENABLE_WRITES: "true",
      PIPEDRIVE_REQUIRE_WRITE_CONFIRMATION: "false",
      PIPEDRIVE_REQUIRE_LAB_PREFIX: "false",
    },
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "pipedrive_create_activity",
      arguments: {
        subject: "Follow up",
        dry_run: false,
      },
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    assert.equal(result.isError, true);
    assert.match(content[0]?.text ?? "", /PIPEDRIVE_API_TOKEN/);
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
      PIPEDRIVE_LOAD_DOTENV: "false",
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
    if (request.url === "/api/v2/tasks/55") {
      response.end(
        JSON.stringify({ success: true, data: { id: 55, title: "MCP LAB - Task", is_done: 1, is_milestone: 0 } }),
      );
      return;
    }
    if (request.url === "/api/v1/mailbox/mailThreads?folder=inbox&start=0&limit=1") {
      response.end(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 91,
              subject: "Secret customer renewal",
              from_address: "customer@example.com",
              snippet: "Sensitive snippet",
            },
          ],
        }),
      );
      return;
    }
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
      PIPEDRIVE_LOAD_DOTENV: "false",
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
      { name: "pipedrive_mailbox_probe", arguments: {} },
      { name: "pipedrive_list_mail_threads", arguments: { folder: "inbox", limit: 19, start: 4 } },
      { name: "pipedrive_get_mail_thread", arguments: { mail_thread_id: 91 } },
      { name: "pipedrive_list_mail_thread_messages", arguments: { mail_thread_id: 91 } },
      { name: "pipedrive_get_mail_message", arguments: { mail_message_id: 92, include_body: true } },
      { name: "pipedrive_list_project_boards", arguments: {} },
      { name: "pipedrive_get_project_board", arguments: { board_id: 60 } },
      { name: "pipedrive_list_project_phases", arguments: { board_id: 60 } },
      { name: "pipedrive_get_project_phase", arguments: { phase_id: 61 } },
      { name: "pipedrive_list_project_templates", arguments: { limit: 19, cursor: "tmpl1" } },
      { name: "pipedrive_get_project_template", arguments: { template_id: 62 } },
      { name: "pipedrive_list_project_fields", arguments: { limit: 20, cursor: "projf1" } },
      { name: "pipedrive_get_project_field", arguments: { field_code: "field_hash" } },
      {
        name: "pipedrive_list_projects",
        arguments: { status: "open", phase_id: 61, deal_id: 123, person_id: 11, org_id: 12, limit: 21, cursor: "proj1" },
      },
      { name: "pipedrive_get_project", arguments: { project_id: 50 } },
      {
        name: "pipedrive_search_projects",
        arguments: {
          term: "migration",
          fields: ["title", "description"],
          exact_match: true,
          person_id: 11,
          organization_id: 12,
          limit: 22,
          cursor: "projs1",
        },
      },
      { name: "pipedrive_list_archived_projects", arguments: { status: "completed", phase_id: 61, limit: 23, cursor: "arch1" } },
      {
        name: "pipedrive_list_tasks",
        arguments: { project_id: 50, is_done: true, is_milestone: false, assignee_id: 7, limit: 24, cursor: "task1" },
      },
      { name: "pipedrive_get_task", arguments: { task_id: 55 } },
    ];

    for (const call of calls) {
      const result = await client.callTool(call);
      assert.equal(result.isError, undefined);
      if (call.name === "pipedrive_get_task") {
        const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
        assert.match(text, /"done": true/);
        assert.match(text, /"milestone": false/);
      }
      if (call.name === "pipedrive_mailbox_probe") {
        const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
        assert.match(text, /"mailbox_read_ok": true/);
        assert.match(text, /"subject"/);
        assert.doesNotMatch(text, /Secret customer renewal|customer@example\.com|Sensitive snippet/);
      }
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
    assert.ok(urls.includes("/api/v1/mailbox/mailThreads?folder=inbox&start=0&limit=1"));
    assert.ok(urls.includes("/api/v1/mailbox/mailThreads?folder=inbox&limit=19&start=4"));
    assert.ok(urls.includes("/api/v1/mailbox/mailThreads/91"));
    assert.ok(urls.includes("/api/v1/mailbox/mailThreads/91/mailMessages"));
    assert.ok(urls.includes("/api/v1/mailbox/mailMessages/92?include_body=1"));
    assert.ok(urls.includes("/api/v2/boards"));
    assert.ok(urls.includes("/api/v2/boards/60"));
    assert.ok(urls.includes("/api/v2/phases?board_id=60"));
    assert.ok(urls.includes("/api/v2/phases/61"));
    assert.ok(urls.includes("/api/v2/projectTemplates?limit=19&cursor=tmpl1"));
    assert.ok(urls.includes("/api/v2/projectTemplates/62"));
    assert.ok(urls.includes("/api/v2/projectFields?limit=20&cursor=projf1"));
    assert.ok(urls.includes("/api/v2/projectFields/field_hash"));
    assert.ok(
      urls.includes(
        "/api/v2/projects?status=open&phase_id=61&deal_id=123&person_id=11&org_id=12&limit=21&cursor=proj1",
      ),
    );
    assert.ok(urls.includes("/api/v2/projects/50"));
    assert.ok(
      urls.includes(
        "/api/v2/projects/search?term=migration&fields=title%2Cdescription&exact_match=true&person_id=11&organization_id=12&limit=22&cursor=projs1",
      ),
    );
    assert.ok(urls.includes("/api/v2/projects/archived?status=completed&phase_id=61&limit=23&cursor=arch1"));
    assert.ok(
      urls.includes(
        "/api/v2/tasks?is_done=true&is_milestone=false&assignee_id=7&project_id=50&limit=24&cursor=task1",
      ),
    );
    assert.ok(urls.includes("/api/v2/tasks/55"));
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
      PIPEDRIVE_LOAD_DOTENV: "false",
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
        arguments: { subject: "Activity", person_id: 11, dry_run: false, confirmation: "YES_WRITE" },
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
        arguments: { organization_id: 12, name: "Acme Updated", dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_create_lead",
        arguments: {
          title: "Qualified lead",
          person_id: 11,
          organization_id: 12,
          value: 100,
          currency: "EUR",
          dry_run: false,
          confirmation: "YES_WRITE",
        },
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
        arguments: { activity_id: 20, subject: "Updated activity", person_id: 11, dry_run: false, confirmation: "YES_WRITE" },
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
          person_id: 11,
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
    assert.deepEqual(requested[0]?.body, {
      subject: "Activity",
      type: "task",
      participants: [{ person_id: 11, primary: true }],
    });
    assert.deepEqual(requested[2]?.body, { stage_id: 5 });
    assert.deepEqual(requested[4]?.body, { status: "won" });
    assert.deepEqual(requested[6]?.body, { product_id: 40, item_price: 250, quantity: 2 });
    assert.deepEqual(requested[7]?.body, { person_id: 11 });
    assert.deepEqual(requested[8]?.body, { user_id: 7 });
    assert.deepEqual(requested[9]?.body, {
      name: "Ada Lovelace",
      emails: [{ value: "ada@example.com", primary: true, label: "work" }],
    });
    assert.deepEqual(requested[10]?.body, { phones: [{ value: "+33123456789", primary: true, label: "work" }] });
    assert.deepEqual(requested[12]?.body, { name: "Acme Updated" });
    assert.deepEqual(requested[13]?.body, {
      title: "Qualified lead",
      person_id: 11,
      organization_id: 12,
      value: { amount: 100, currency: "EUR" },
    });
    assert.deepEqual(requested[15]?.body, { content: "Discovery note", deal_id: 123 });
    assert.deepEqual(requested[16]?.body, { content: "Updated note" });
    assert.deepEqual(requested[17]?.body, { stage_id: 5 });
    assert.deepEqual(requested[18]?.body, {
      subject: "Updated activity",
      participants: [{ person_id: 11, primary: true }],
    });
    assert.equal((requested[19]?.body as { done?: boolean }).done, true);
    assert.equal((requested[20]?.body as { due_date?: string }).due_date, "2026-05-25");
    assert.deepEqual(requested[21]?.body, {
      subject: "Call done",
      type: "call",
      done: true,
      deal_id: 123,
      participants: [{ person_id: 11, primary: true }],
    });
    assert.deepEqual(requested[22]?.body, {
      subject: "Follow up",
      type: "task",
      due_date: "2026-05-24",
      deal_id: 123,
      participants: [{ person_id: 11, primary: true }],
    });
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("mail thread linking is guarded and sends form-encoded payloads", async () => {
  const requested: Array<{ method: string; url: string; body: string; contentType: string; token: string }> = [];
  const api = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) {
      text += chunk.toString();
    }
    requested.push({
      method: request.method ?? "",
      url: request.url ?? "",
      body: text,
      contentType: request.headers["content-type"]?.toString() ?? "",
      token: request.headers["x-api-token"]?.toString() ?? "",
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, data: { id: 999, title: "Linked" } }));
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
      PIPEDRIVE_LOAD_DOTENV: "false",
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
      name: "pipedrive_link_mail_thread",
      arguments: { mail_thread_id: 91, deal_id: 123, dry_run: true, validate_links: false },
    });
    assert.equal(dryRun.isError, undefined);
    assert.match((dryRun.content as Array<{ text?: string }>)[0]?.text ?? "", /"dry_run": true/);
    assert.equal(requested.length, 0);

    const invalidTarget = await client.callTool({
      name: "pipedrive_link_mail_thread",
      arguments: {
        mail_thread_id: 91,
        deal_id: 123,
        lead_id: "11111111-1111-4111-8111-111111111111",
        dry_run: true,
      },
    });
    assert.equal(invalidTarget.isError, true);
    assert.equal(requested.length, 0);

    const rejected = await client.callTool({
      name: "pipedrive_link_mail_thread",
      arguments: { mail_thread_id: 91, deal_id: 123, dry_run: false, confirmation: "WRONG" },
    });
    assert.equal(rejected.isError, true);
    assert.equal(requested.length, 0);

    const linked = await client.callTool({
      name: "pipedrive_link_mail_thread",
      arguments: { mail_thread_id: 91, deal_id: 123, dry_run: false, confirmation: "YES_WRITE" },
    });
    assert.equal(linked.isError, undefined);
    assert.deepEqual(
      requested.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/deals/123", "PUT /api/v1/mailbox/mailThreads/91"],
    );
    assert.equal(requested[1]?.contentType, "application/x-www-form-urlencoded");
    assert.equal(requested[1]?.body, "deal_id=123");
    assert.equal(requested.every((entry) => entry.token === "test-token"), true);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("mail thread linking accepts lab confirmation only for lab-scoped targets", async () => {
  const requested: Array<{ method: string; url: string; body: string; contentType: string; token: string }> = [];
  const api = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) {
      text += chunk.toString();
    }
    requested.push({
      method: request.method ?? "",
      url: request.url ?? "",
      body: text,
      contentType: request.headers["content-type"]?.toString() ?? "",
      token: request.headers["x-api-token"]?.toString() ?? "",
    });

    const url = request.url ?? "";
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
    response.end(JSON.stringify({ success: true, data: { id: 999, title: "Linked" } }));
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
      PIPEDRIVE_LOAD_DOTENV: "false",
      PIPEDRIVE_BASE_URL: `http://127.0.0.1:${port}`,
      PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
      PIPEDRIVE_API_TOKEN: "test-token",
      PIPEDRIVE_ENABLE_WRITES: "true",
      PIPEDRIVE_ALLOW_LAB_WRITE_CONFIRMATION: "true",
      PIPEDRIVE_REQUIRE_LAB_PREFIX: "true",
      PIPEDRIVE_LAB_PREFIX: "MCP LAB -",
    },
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    const unconfirmed = await client.callTool({
      name: "pipedrive_link_mail_thread",
      arguments: { mail_thread_id: 91, deal_id: 124, dry_run: false, validate_links: false },
    });
    assert.equal(unconfirmed.isError, true);
    assert.match((unconfirmed.content as Array<{ text?: string }>)[0]?.text ?? "", /Write confirmation/);
    assert.equal(requested.length, 0);

    const unsafeTarget = await client.callTool({
      name: "pipedrive_link_mail_thread",
      arguments: { mail_thread_id: 91, deal_id: 123, dry_run: false, validate_links: false, confirm_lab_write: true },
    });
    assert.equal(unsafeTarget.isError, true);
    assert.match((unsafeTarget.content as Array<{ text?: string }>)[0]?.text ?? "", /MCP LAB -/);
    assert.deepEqual(
      requested.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/deals/123"],
    );

    const linked = await client.callTool({
      name: "pipedrive_link_mail_thread",
      arguments: { mail_thread_id: 91, deal_id: 124, dry_run: false, validate_links: true, confirm_lab_write: true },
    });
    assert.equal(linked.isError, undefined);
    assert.deepEqual(
      requested.slice(-3).map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/deals/124", "GET /api/v2/deals/124", "PUT /api/v1/mailbox/mailThreads/91"],
    );
    assert.equal(requested.at(-1)?.contentType, "application/x-www-form-urlencoded");
    assert.equal(requested.at(-1)?.body, "deal_id=124");
    assert.equal(requested.every((entry) => entry.token === "test-token"), true);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("project and task write tools send expected methods and payloads", async () => {
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
      PIPEDRIVE_LOAD_DOTENV: "false",
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
      name: "pipedrive_create_project",
      arguments: {
        title: "MCP LAB - Project",
        board_id: 60,
        phase_id: 61,
        dry_run: true,
      },
    });
    assert.equal(dryRun.isError, undefined);
    assert.match((dryRun.content as Array<{ text?: string }>)[0]?.text ?? "", /"dry_run": true/);
    assert.equal(requested.length, 0);

    const calls = [
      {
        name: "pipedrive_create_project",
        arguments: {
          title: "MCP LAB - Project",
          board_id: 60,
          phase_id: 61,
          description: "Project description",
          deal_ids: [123],
          person_ids: [11],
          org_ids: [12],
          label_ids: [70],
          custom_fields: { project_hash: "custom value" },
          dry_run: false,
          confirmation: "YES_WRITE",
        },
      },
      {
        name: "pipedrive_update_project",
        arguments: {
          project_id: 50,
          title: "MCP LAB - Project updated",
          phase_id: 62,
          custom_fields: { project_hash: null },
          dry_run: false,
          confirmation: "YES_WRITE",
        },
      },
      {
        name: "pipedrive_archive_project",
        arguments: { project_id: 50, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_delete_project",
        arguments: { project_id: 50, dry_run: false, confirmation: "YES_WRITE" },
      },
      {
        name: "pipedrive_create_task",
        arguments: {
          title: "MCP LAB - Task",
          project_id: 50,
          description: "Task description",
          done: false,
          milestone: true,
          due_date: "2026-05-25",
          assignee_id: 7,
          priority: 2,
          dry_run: false,
          confirmation: "YES_WRITE",
        },
      },
      {
        name: "pipedrive_update_task",
        arguments: {
          task_id: 55,
          title: "MCP LAB - Task updated",
          done: true,
          milestone: false,
          dry_run: false,
          confirmation: "YES_WRITE",
        },
      },
      {
        name: "pipedrive_delete_task",
        arguments: { task_id: 55, dry_run: false, confirmation: "YES_WRITE" },
      },
    ];

    for (const call of calls) {
      const result = await client.callTool(call);
      assert.equal(result.isError, undefined);
    }

    assert.deepEqual(
      requested.map((entry) => `${entry.method} ${entry.url}`),
      [
        "POST /api/v2/projects",
        "PATCH /api/v2/projects/50",
        "POST /api/v2/projects/50/archive",
        "DELETE /api/v2/projects/50",
        "POST /api/v2/tasks",
        "PATCH /api/v2/tasks/55",
        "DELETE /api/v2/tasks/55",
      ],
    );
    assert.equal(requested.every((entry) => entry.token === "test-token"), true);
    assert.equal(requested.every((entry) => !entry.url.includes("test-token")), true);
    assert.deepEqual(requested[0]?.body, {
      title: "MCP LAB - Project",
      board_id: 60,
      phase_id: 61,
      description: "Project description",
      deal_ids: [123],
      person_ids: [11],
      org_ids: [12],
      label_ids: [70],
      custom_fields: { project_hash: "custom value" },
    });
    assert.deepEqual(requested[1]?.body, {
      title: "MCP LAB - Project updated",
      phase_id: 62,
      custom_fields: { project_hash: null },
    });
    assert.deepEqual(requested[2]?.body, {});
    assert.deepEqual(requested[4]?.body, {
      title: "MCP LAB - Task",
      project_id: 50,
      description: "Task description",
      is_done: false,
      is_milestone: true,
      due_date: "2026-05-25",
      assignee_id: 7,
      priority: 2,
    });
    assert.deepEqual(requested[5]?.body, {
      title: "MCP LAB - Task updated",
      is_done: true,
      is_milestone: false,
    });
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
    if (request.method === "GET" && url === "/api/v2/boards/60") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 60, name: "Delivery" } }));
      return;
    }
    if (request.method === "GET" && url === "/api/v2/phases/61") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 61, name: "Kickoff" } }));
      return;
    }
    if (request.method === "GET" && url === "/api/v2/projects/50") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 50, title: "MCP LAB - Safe project" } }));
      return;
    }
    if (request.method === "GET" && url === "/api/v2/projects/51") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 51, title: "Real customer project" } }));
      return;
    }
    if (request.method === "GET" && url === "/api/v2/tasks/55") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 55, title: "MCP LAB - Safe task" } }));
      return;
    }
    if (request.method === "GET" && url === "/api/v2/tasks/56") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, data: { id: 56, title: "Real customer task" } }));
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
      PIPEDRIVE_LOAD_DOTENV: "false",
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
    assert.match(dryRunText, /"emails": "\[redacted\]"/);
    assert.match(dryRunText, /"phones": "\[redacted\]"/);
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

    const validatedProjectDryRun = await client.callTool({
      name: "pipedrive_create_project",
      arguments: {
        title: "MCP LAB - Project",
        board_id: 60,
        phase_id: 61,
        validate_links: true,
        dry_run: true,
      },
    });
    assert.equal(validatedProjectDryRun.isError, undefined);
    assert.match((validatedProjectDryRun.content as Array<{ text?: string }>)[0]?.text ?? "", /"board:60"/);
    assert.match((validatedProjectDryRun.content as Array<{ text?: string }>)[0]?.text ?? "", /"phase:61"/);
    assert.deepEqual(
      requested.slice(-2).map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/boards/60", "GET /api/v2/phases/61"],
    );

    const unsafeProjectCreate = await client.callTool({
      name: "pipedrive_create_project",
      arguments: {
        title: "Real customer project",
        board_id: 60,
        phase_id: 61,
        dry_run: false,
        confirmation: "YES_WRITE",
      },
    });
    assert.equal(unsafeProjectCreate.isError, true);
    assert.match((unsafeProjectCreate.content as Array<{ text?: string }>)[0]?.text ?? "", /MCP LAB -/);

    const unsafeProjectDelete = await client.callTool({
      name: "pipedrive_delete_project",
      arguments: {
        project_id: 51,
        dry_run: false,
        confirmation: "YES_WRITE",
      },
    });
    assert.equal(unsafeProjectDelete.isError, true);
    assert.equal(requested.at(-1)?.url, "/api/v2/projects/51");

    const safeProjectDelete = await client.callTool({
      name: "pipedrive_delete_project",
      arguments: {
        project_id: 50,
        dry_run: false,
        confirm_lab_write: true,
      },
    });
    assert.equal(safeProjectDelete.isError, undefined);
    assert.deepEqual(
      requested.slice(-2).map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/projects/50", "DELETE /api/v2/projects/50"],
    );

    const unsafeTaskCreate = await client.callTool({
      name: "pipedrive_create_task",
      arguments: {
        title: "Real customer task",
        project_id: 50,
        dry_run: false,
        confirmation: "YES_WRITE",
      },
    });
    assert.equal(unsafeTaskCreate.isError, true);
    assert.match((unsafeTaskCreate.content as Array<{ text?: string }>)[0]?.text ?? "", /MCP LAB -/);

    const milestoneWithoutDueDate = await client.callTool({
      name: "pipedrive_create_task",
      arguments: {
        title: "MCP LAB - Milestone",
        project_id: 50,
        milestone: true,
        dry_run: true,
      },
    });
    assert.equal(milestoneWithoutDueDate.isError, true);
    assert.match((milestoneWithoutDueDate.content as Array<{ text?: string }>)[0]?.text ?? "", /milestone tasks require due_date/);

    const validatedTaskDryRun = await client.callTool({
      name: "pipedrive_create_task",
      arguments: {
        title: "MCP LAB - Task",
        project_id: 50,
        validate_links: true,
        dry_run: true,
      },
    });
    assert.equal(validatedTaskDryRun.isError, undefined);
    assert.match((validatedTaskDryRun.content as Array<{ text?: string }>)[0]?.text ?? "", /"project:50"/);
    assert.equal(requested.at(-1)?.url, "/api/v2/projects/50");

    const unsafeTaskDelete = await client.callTool({
      name: "pipedrive_delete_task",
      arguments: {
        task_id: 56,
        dry_run: false,
        confirmation: "YES_WRITE",
      },
    });
    assert.equal(unsafeTaskDelete.isError, true);
    assert.equal(requested.at(-1)?.url, "/api/v2/tasks/56");

    const safeTaskDelete = await client.callTool({
      name: "pipedrive_delete_task",
      arguments: {
        task_id: 55,
        dry_run: false,
        confirm_lab_write: true,
      },
    });
    assert.equal(safeTaskDelete.isError, undefined);
    assert.deepEqual(
      requested.slice(-2).map((entry) => `${entry.method} ${entry.url}`),
      ["GET /api/v2/tasks/55", "DELETE /api/v2/tasks/55"],
    );
  } finally {
    await client.close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});
