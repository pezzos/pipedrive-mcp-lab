import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const coreReadTools = [
  "pipedrive_health_check",
  "pipedrive_list_deals",
  "pipedrive_get_deal",
  "pipedrive_search_items",
  "pipedrive_find_deals",
  "pipedrive_list_persons",
  "pipedrive_get_person",
  "pipedrive_search_persons",
  "pipedrive_list_organizations",
  "pipedrive_get_organization",
  "pipedrive_list_leads",
  "pipedrive_get_lead",
  "pipedrive_list_pipelines",
  "pipedrive_get_pipeline",
  "pipedrive_list_stages",
  "pipedrive_list_activities",
  "pipedrive_get_activity",
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
];

const mailboxTools = [
  "pipedrive_list_deal_mail_messages",
  "pipedrive_mailbox_probe",
  "pipedrive_list_mail_threads",
  "pipedrive_get_mail_thread",
  "pipedrive_list_mail_thread_messages",
  "pipedrive_get_mail_message",
  "pipedrive_link_mail_thread",
];

const nonDeleteWriteTools = [
  "pipedrive_create_project",
  "pipedrive_update_project",
  "pipedrive_archive_project",
  "pipedrive_create_task",
  "pipedrive_update_task",
  "pipedrive_create_activity",
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
];

const deleteTools = [
  "pipedrive_delete_project",
  "pipedrive_delete_task",
  "pipedrive_delete_activity",
  "pipedrive_delete_deal",
  "pipedrive_delete_lead",
  "pipedrive_delete_note",
  "pipedrive_delete_organization",
  "pipedrive_delete_person",
];

test("starts over stdio and lists only read tools when writes are disabled", async () => {
  const { client, close } = await connectMcp({ PIPEDRIVE_ENABLE_WRITES: "false" });
  try {
    const toolNames = await listToolNames(client);
    assertToolSet(toolNames, coreReadTools);
    assertAbsent(toolNames, [...mailboxTools, ...nonDeleteWriteTools, ...deleteTools]);
    assert.equal(toolNames.length, coreReadTools.length);

    const health = await callJson(client, "pipedrive_health_check", {});
    assert.equal(health.writes_enabled, false);
    assert.equal(health.delete_tools_enabled, false);
    assert.equal(health.mailbox_tools_enabled, false);
    assert.equal(health.runtime_env_diagnostics_initialized, true);
    assert.equal(health.dotenv_loading_enabled, false);
    assert.equal(health.dotenv_local_file_present, false);
    assert.equal(health.dotenv_loaded, false);
    assert.equal(health.request_timeout_ms, 10000);
    assert.equal(health.runtime_env_preexisting_enable_writes, true);
    assert.equal(health.runtime_env_preexisting_enable_delete_tools, false);
    assert.equal(health.runtime_env_preexisting_enable_mailbox_tools, false);
    assert.equal(health.runtime_env_current_has_enable_writes, true);
    assert.equal(health.runtime_env_current_has_enable_delete_tools, false);
    assert.equal(health.runtime_env_current_has_enable_mailbox_tools, false);
    assert.equal(JSON.stringify(health).includes("test-token"), false);
    assert.equal(JSON.stringify(health).includes("lab"), false);
  } finally {
    await close();
  }
});

test("lists write tools when writes are enabled but hides mailbox and delete tools", async () => {
  const { client, close } = await connectMcp({ PIPEDRIVE_ENABLE_WRITES: "true" });
  try {
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    assertToolSet(toolNames, [...coreReadTools, ...nonDeleteWriteTools]);
    assertAbsent(toolNames, [...mailboxTools, ...deleteTools]);
    assert.equal(toolNames.length, coreReadTools.length + nonDeleteWriteTools.length);

    const createDeal = listed.tools.find((tool) => tool.name === "pipedrive_create_deal");
    const schemaText = JSON.stringify(createDeal?.inputSchema);
    assert.match(schemaText, /dry_run/);
    assert.match(schemaText, /validate_links/);
    assert.doesNotMatch(schemaText, new RegExp(`${"confirm_" + "lab_write"}|confirmation`));
  } finally {
    await close();
  }
});

test("lists mailbox tools only when writes and mailbox tools are enabled", async () => {
  const { client, close } = await connectMcp({
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
  });
  try {
    const listed = await client.listTools();
    const toolNames = listed.tools.map((tool) => tool.name);
    assertToolSet(toolNames, [...coreReadTools, ...mailboxTools, ...nonDeleteWriteTools]);
    assertAbsent(toolNames, deleteTools);
    assert.equal(toolNames.length, coreReadTools.length + mailboxTools.length + nonDeleteWriteTools.length);

    const linkMailThread = listed.tools.find((tool) => tool.name === "pipedrive_link_mail_thread");
    const schemaText = JSON.stringify(linkMailThread?.inputSchema);
    assert.match(schemaText, /dry_run/);
    assert.match(schemaText, /validate_links/);
    const health = await callJson(client, "pipedrive_health_check", {});
    assert.equal(health.mailbox_tools_enabled, true);
    assert.equal(health.runtime_env_current_has_enable_mailbox_tools, true);
  } finally {
    await close();
  }
});

test("does not list mailbox tools when only the mailbox flag is enabled", async () => {
  const { client, close } = await connectMcp({
    PIPEDRIVE_ENABLE_WRITES: "false",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
  });
  try {
    const toolNames = await listToolNames(client);
    assertToolSet(toolNames, coreReadTools);
    assertAbsent(toolNames, [...mailboxTools, ...nonDeleteWriteTools, ...deleteTools]);
    const health = await callJson(client, "pipedrive_health_check", {});
    assert.equal(health.mailbox_tools_enabled, false);
    assert.equal(health.runtime_env_current_has_enable_mailbox_tools, true);
  } finally {
    await close();
  }
});

test("does not list delete tools when only the delete flag is enabled", async () => {
  const { client, close } = await connectMcp({
    PIPEDRIVE_ENABLE_WRITES: "false",
    PIPEDRIVE_ENABLE_DELETE_TOOLS: "true",
  });
  try {
    const toolNames = await listToolNames(client);
    assertToolSet(toolNames, coreReadTools);
    assertAbsent(toolNames, [...mailboxTools, ...nonDeleteWriteTools, ...deleteTools]);
    const health = await callJson(client, "pipedrive_health_check", {});
    assert.equal(health.writes_enabled, false);
    assert.equal(health.delete_tools_enabled, false);
    assert.equal(health.runtime_env_current_has_enable_delete_tools, true);
  } finally {
    await close();
  }
});

test("lists delete tools only when writes and delete tools are enabled", async () => {
  const { client, close } = await connectMcp({
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_ENABLE_DELETE_TOOLS: "true",
  });
  try {
    const toolNames = await listToolNames(client);
    assertToolSet(toolNames, [...coreReadTools, ...nonDeleteWriteTools, ...deleteTools]);
    assertAbsent(toolNames, mailboxTools);
    assert.equal(
      toolNames.length,
      coreReadTools.length + nonDeleteWriteTools.length + deleteTools.length,
    );
  } finally {
    await close();
  }
});

test("write tools dry-run without a token and real writes only require writes enabled", async () => {
  const { client, close } = await connectMcp({
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_API_TOKEN: undefined,
  });
  try {
    const dryRun = await callJson(client, "pipedrive_create_deal", {
      title: "Production dry run",
      dry_run: true,
    });
    assert.equal(dryRun.dry_run, true);
    assert.equal(dryRun.writes_enabled, true);

    const liveAttempt = await client.callTool({
      name: "pipedrive_create_deal",
      arguments: {
        title: "Production write",
        dry_run: false,
      },
    });
    const text = firstText(liveAttempt);
    assert.equal(liveAttempt.isError, true);
    assert.match(text, /PIPEDRIVE_API_TOKEN/);
    assert.doesNotMatch(text, new RegExp(`confirmation|${"MCP " + "LAB"}|${"PIPEDRIVE_" + "LAB"}`));
  } finally {
    await close();
  }
});

test("dry-run redacts secret-like custom fields", async () => {
  const { client, close } = await connectMcp({ PIPEDRIVE_ENABLE_WRITES: "true" });
  try {
    const projectDryRun = await callJson(client, "pipedrive_create_project", {
      title: "Secret project",
      board_id: 1,
      phase_id: 2,
      custom_fields: {
        project_field_hash: "customer-secret",
      },
      dry_run: true,
    });
    assert.deepEqual(projectDryRun.would_send, {
      title: "Secret project",
      board_id: 1,
      phase_id: 2,
      custom_fields: {
        project_field_hash: "[redacted]",
      },
    });
    assert.equal(JSON.stringify(projectDryRun).includes("customer-secret"), false);

    const dealDryRun = await callJson(client, "pipedrive_create_deal", {
      title: "Secret deal",
      custom_fields: {
        client_secret: "spread-secret",
        a1b2c3d4e5f67890: "opaque-field-secret",
      },
      dry_run: true,
    });
    assert.equal((dealDryRun.would_send as Record<string, unknown>).client_secret, "[redacted]");
    assert.equal((dealDryRun.would_send as Record<string, unknown>).a1b2c3d4e5f67890, "[redacted]");
    assert.equal(JSON.stringify(dealDryRun).includes("spread-secret"), false);
    assert.equal(JSON.stringify(dealDryRun).includes("opaque-field-secret"), false);

    const organizationDryRun = await callJson(client, "pipedrive_update_organization", {
      organization_id: 10,
      custom_fields: {
        abcdef1234567890: "org-secret",
      },
      dry_run: true,
    });
    assert.equal((organizationDryRun.would_send as Record<string, unknown>).abcdef1234567890, "[redacted]");
    assert.equal(JSON.stringify(organizationDryRun).includes("org-secret"), false);
  } finally {
    await close();
  }
});

test("email activity dry-run links person deal and organization", async () => {
  const { client, close } = await connectMcp({ PIPEDRIVE_ENABLE_WRITES: "true" });
  try {
    const dryRun = await callJson(client, "pipedrive_create_activity", {
      subject: "Email follow-up",
      type: "email",
      owner_id: 77,
      person_id: 11,
      deal_id: 22,
      org_id: 33,
      note: "<p>Draft body for the email activity.</p>",
      dry_run: true,
    });

    assert.equal(dryRun.dry_run, true);
    assert.deepEqual(dryRun.would_send, {
      subject: "[redacted]",
      type: "email",
      owner_id: 77,
      deal_id: 22,
      org_id: 33,
      note: "[redacted]",
      participants: [{ person_id: 11, primary: true }],
    });
  } finally {
    await close();
  }
});

test("read and write calls use expected Pipedrive endpoints and validate_links behavior", async () => {
  const requested: Array<{ method: string; path: string; token: string; body: string }> = [];
  const api = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requested.push({
        method: request.method ?? "",
        path: request.url ?? "",
        token: String(request.headers["x-api-token"] ?? ""),
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ success: true, data: [{ id: 1, title: "OK" }] }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const { client, close } = await connectMcp({
    PIPEDRIVE_BASE_URL: baseUrl,
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
    PIPEDRIVE_ENABLE_WRITES: "true",
  });
  try {
    await callJson(client, "pipedrive_list_deals", { limit: 1 });
    await callJson(client, "pipedrive_update_deal", {
      deal_id: 123,
      title: "Updated",
      dry_run: false,
      validate_links: true,
    });
    await callJson(client, "pipedrive_update_deal", {
      deal_id: 456,
      title: "Updated without validation",
      dry_run: false,
      validate_links: false,
    });

    assert.equal(requested[0]?.method, "GET");
    assert.match(requested[0]?.path ?? "", /^\/api\/v2\/deals\?/);
    assert.equal(requested[0]?.token, "test-token");
    assert.equal(requested.some((entry) => entry.path.includes("test-token")), false);

    assert.equal(requested[1]?.method, "GET");
    assert.equal(requested[1]?.path, "/api/v2/deals/123");
    assert.equal(requested[2]?.method, "PATCH");
    assert.equal(requested[2]?.path, "/api/v2/deals/123");
    assert.equal(requested[3]?.method, "PATCH");
    assert.equal(requested[3]?.path, "/api/v2/deals/456");
  } finally {
    await close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("create task maps public fields to Pipedrive task payload fields", async () => {
  const requested: Array<{ method: string; path: string; body: string }> = [];
  const api = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requested.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ success: true, data: { id: 7, title: "Mapped task" } }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const { client, close } = await connectMcp({
    PIPEDRIVE_BASE_URL: baseUrl,
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
  });
  try {
    await callJson(client, "pipedrive_create_task", {
      title: "Mapped task",
      project_id: 42,
      done: true,
      milestone: false,
      dry_run: false,
      validate_links: false,
    });

    assert.equal(requested.length, 1);
    assert.equal(requested[0]?.method, "POST");
    assert.equal(requested[0]?.path, "/api/v2/tasks");
    const body = JSON.parse(requested[0]?.body ?? "{}") as Record<string, unknown>;
    assert.equal(body.title, "Mapped task");
    assert.equal(body.project_id, 42);
    assert.equal(body.is_done, true);
    assert.equal(body.is_milestone, false);
    assert.equal("done" in body, false);
    assert.equal("milestone" in body, false);
  } finally {
    await close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("list task filters map public fields to Pipedrive query fields", async () => {
  const requested: Array<{ method: string; path: string }> = [];
  const api = createServer((request, response) => {
    requested.push({
      method: request.method ?? "",
      path: request.url ?? "",
    });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ success: true, data: [] }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const { client, close } = await connectMcp({
    PIPEDRIVE_BASE_URL: baseUrl,
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
  });
  try {
    await callJson(client, "pipedrive_list_tasks", {
      done: true,
      milestone: false,
      limit: 1,
    });

    assert.equal(requested.length, 1);
    assert.equal(requested[0]?.method, "GET");
    const url = new URL(requested[0]?.path ?? "", "http://127.0.0.1");
    assert.equal(url.pathname, "/api/v2/tasks");
    assert.equal(url.searchParams.get("is_done"), "true");
    assert.equal(url.searchParams.get("is_milestone"), "false");
    assert.equal(url.searchParams.has("done"), false);
    assert.equal(url.searchParams.has("milestone"), false);
  } finally {
    await close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("update note preserves existing links before PUT", async () => {
  const requested: Array<{ method: string; path: string; body: string }> = [];
  const api = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requested.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      response.setHeader("content-type", "application/json");
      if (request.method === "GET") {
        response.end(JSON.stringify({ success: true, data: { id: 9, content: "Old", deal_id: 123 } }));
        return;
      }
      response.end(JSON.stringify({ success: true, data: { id: 9, content: "New" } }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const { client, close } = await connectMcp({
    PIPEDRIVE_BASE_URL: baseUrl,
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
    PIPEDRIVE_ENABLE_WRITES: "true",
  });
  try {
    await callJson(client, "pipedrive_update_note", {
      note_id: 9,
      content: "New",
      dry_run: false,
      validate_links: false,
    });

    assert.equal(requested.length, 2);
    assert.equal(requested[0]?.method, "GET");
    assert.equal(requested[0]?.path, "/api/v1/notes/9");
    assert.equal(requested[1]?.method, "PUT");
    assert.equal(requested[1]?.path, "/api/v1/notes/9");
    assert.deepEqual(JSON.parse(requested[1]?.body ?? "{}"), {
      deal_id: 123,
      content: "New",
    });
  } finally {
    await close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("log call workflow returns partial result when follow-up creation fails", async () => {
  const requested: Array<{ method: string; path: string; body: string }> = [];
  const api = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requested.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      response.setHeader("content-type", "application/json");
      if (requested.length === 2) {
        response.statusCode = 422;
        response.end(JSON.stringify({ error: "follow up rejected" }));
        return;
      }
      response.end(JSON.stringify({ success: true, data: { id: 55, subject: "Call" } }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const { client, close } = await connectMcp({
    PIPEDRIVE_BASE_URL: baseUrl,
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
    PIPEDRIVE_ENABLE_WRITES: "true",
  });
  try {
    const result = await callJson(client, "pipedrive_log_call_and_schedule_follow_up", {
      call_subject: "Call",
      follow_up_subject: "Next step",
      follow_up_due_date: "2026-07-02",
      dry_run: false,
      validate_links: false,
    });

    assert.equal(requested.length, 2);
    assert.equal(result.partial, true);
    assert.match(String(result.follow_up_error), /follow up rejected/);
    assert.deepEqual(result.call, { success: true, data: { id: 55, subject: "Call" } });
  } finally {
    await close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

test("mailbox link uses one validation path and form-encoded payload", async () => {
  const requested: Array<{ method: string; path: string; body: string }> = [];
  const api = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requested.push({
        method: request.method ?? "",
        path: request.url ?? "",
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ success: true, data: { id: 1, title: "OK" } }));
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const { client, close } = await connectMcp({
    PIPEDRIVE_BASE_URL: baseUrl,
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
  });
  try {
    await callJson(client, "pipedrive_link_mail_thread", {
      mail_thread_id: 91,
      deal_id: 123,
      dry_run: false,
      validate_links: true,
    });
    assert.deepEqual(
      requested.map((entry) => [entry.method, entry.path, entry.body]),
      [
        ["GET", "/api/v2/deals/123", ""],
        ["PUT", "/api/v1/mailbox/mailThreads/91", "deal_id=123"],
      ],
    );
  } finally {
    await close();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
});

async function connectMcp(extraEnv: Record<string, string | undefined>) {
  const client = new Client({ name: "pipedrive-mcp-test", version: "0.1.0" });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    PIPEDRIVE_LOAD_DOTENV: "false",
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
    PIPEDRIVE_API_TOKEN: "test-token",
  };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/server.js"],
    cwd: process.cwd(),
    env,
    stderr: "pipe",
  });
  await client.connect(transport);
  return {
    client,
    close: async () => client.close(),
  };
}

async function listToolNames(client: Client) {
  const listed = await client.listTools();
  return listed.tools.map((tool) => tool.name);
}

function assertToolSet(actual: string[], expected: string[]) {
  for (const name of expected) {
    assert.ok(actual.includes(name), `missing ${name}`);
  }
}

function assertAbsent(actual: string[], expected: string[]) {
  for (const name of expected) {
    assert.equal(actual.includes(name), false, `unexpected ${name}`);
  }
}

async function callJson(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, firstText(result));
  return JSON.parse(firstText(result)) as Record<string, unknown>;
}

function firstText(result: { content?: unknown }) {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  return content?.[0]?.type === "text" ? (content[0].text ?? "") : "";
}
