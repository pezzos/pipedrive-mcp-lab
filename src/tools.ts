import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { PipedriveConfig } from "./config.js";
import { PipedriveClient } from "./pipedriveClient.js";

const pipedriveDateTime = z.string().datetime({ offset: true });

const cursorPagination = {
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
};

const startPagination = {
  limit: z.number().int().min(1).max(100).default(20),
  start: z.number().int().min(0).optional(),
};

const searchItemType = z.enum([
  "deal",
  "person",
  "organization",
  "product",
  "lead",
  "file",
  "mail_attachment",
  "project",
]);

function commaList(values?: string[]) {
  return values?.length ? values.join(",") : undefined;
}

export function buildServer(config: PipedriveConfig, client = new PipedriveClient(config)) {
  const server = new McpServer({
    name: "pipedrive-mcp-lab",
    version: "0.1.0",
  });

  server.registerTool(
    "pipedrive_health_check",
    {
      title: "Pipedrive MCP Health Check",
      description:
        "Report local configuration state without exposing the API token. Does not test live API connectivity.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () =>
      jsonResult({
        token_configured: Boolean(config.apiToken),
        company_domain_configured: Boolean(config.companyDomain),
        base_url_configured: Boolean(config.baseUrl),
        writes_enabled: config.enableWrites,
      }),
  );

  server.registerTool(
    "pipedrive_list_deals",
    {
      description: "List deals with optional Pipedrive filters.",
      inputSchema: {
        status: z.enum(["open", "won", "lost", "deleted"]).optional(),
        owner_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        pipeline_id: z.number().int().positive().optional(),
        stage_id: z.number().int().positive().optional(),
        updated_since: pipedriveDateTime.optional(),
        updated_until: pipedriveDateTime.optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/deals", args)),
  );

  server.registerTool(
    "pipedrive_get_deal",
    {
      description: "Get one deal by id.",
      inputSchema: {
        deal_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ deal_id }) => jsonResult(await client.get(`/api/v2/deals/${deal_id}`)),
  );

  server.registerTool(
    "pipedrive_search_items",
    {
      description: "Search across Pipedrive items such as deals, persons, organizations, leads and products.",
      inputSchema: {
        term: z.string().min(2),
        item_types: z.array(searchItemType).min(1).max(8).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        cursor: z.string().min(1).optional(),
        exact_match: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ term, item_types, limit, cursor, exact_match }) =>
      jsonResult(
        await client.get("/api/v2/itemSearch", {
          term,
          item_types: commaList(item_types),
          limit,
          cursor,
          exact_match,
        }),
      ),
  );

  server.registerTool(
    "pipedrive_list_persons",
    {
      description: "List Pipedrive contact persons.",
      inputSchema: {
        owner_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        updated_since: pipedriveDateTime.optional(),
        updated_until: pipedriveDateTime.optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/persons", args)),
  );

  server.registerTool(
    "pipedrive_get_person",
    {
      description: "Get one Pipedrive contact person by id.",
      inputSchema: {
        person_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ person_id }) => jsonResult(await client.get(`/api/v2/persons/${person_id}`)),
  );

  server.registerTool(
    "pipedrive_search_persons",
    {
      description:
        "Search persons by term using the legacy narrow v1 endpoint. Use pipedrive_search_items for broader v2 search.",
      inputSchema: {
        term: z.string().min(2),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ term, limit }) => jsonResult(await client.get("/api/v1/persons/search", { term, limit })),
  );

  server.registerTool(
    "pipedrive_list_organizations",
    {
      description: "List Pipedrive organizations.",
      inputSchema: {
        owner_id: z.number().int().positive().optional(),
        updated_since: pipedriveDateTime.optional(),
        updated_until: pipedriveDateTime.optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/organizations", args)),
  );

  server.registerTool(
    "pipedrive_get_organization",
    {
      description: "Get one Pipedrive organization by id.",
      inputSchema: {
        organization_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ organization_id }) =>
      jsonResult(await client.get(`/api/v2/organizations/${organization_id}`)),
  );

  server.registerTool(
    "pipedrive_list_leads",
    {
      description: "List Pipedrive leads.",
      inputSchema: {
        owner_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        organization_id: z.number().int().positive().optional(),
        ...startPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ organization_id, ...args }) =>
      jsonResult(await client.get("/api/v1/leads", { ...args, org_id: organization_id })),
  );

  server.registerTool(
    "pipedrive_get_lead",
    {
      description: "Get one Pipedrive lead by id.",
      inputSchema: {
        lead_id: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ lead_id }) => jsonResult(await client.get(`/api/v1/leads/${lead_id}`)),
  );

  server.registerTool(
    "pipedrive_list_pipelines",
    {
      description: "List Pipedrive pipelines.",
      inputSchema: {
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/pipelines", args)),
  );

  server.registerTool(
    "pipedrive_get_pipeline",
    {
      description: "Get one Pipedrive pipeline by id.",
      inputSchema: {
        pipeline_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ pipeline_id }) => jsonResult(await client.get(`/api/v2/pipelines/${pipeline_id}`)),
  );

  server.registerTool(
    "pipedrive_list_stages",
    {
      description: "List Pipedrive stages, optionally scoped to a pipeline.",
      inputSchema: {
        pipeline_id: z.number().int().positive().optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/stages", args)),
  );

  server.registerTool(
    "pipedrive_list_activities",
    {
      description:
        "List activities by update time; optionally filter by deal, lead, person, organization, owner, or done status.",
      inputSchema: {
        deal_id: z.number().int().positive().optional(),
        lead_id: z.string().uuid().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        owner_id: z.number().int().positive().optional(),
        done: z.boolean().optional(),
        updated_since: pipedriveDateTime.optional(),
        updated_until: pipedriveDateTime.optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({
      deal_id,
      lead_id,
      person_id,
      org_id,
      owner_id,
      done,
      updated_since,
      updated_until,
      limit,
      cursor,
    }) =>
      jsonResult(
        await client.get("/api/v2/activities", {
          deal_id,
          lead_id,
          person_id,
          org_id,
          owner_id,
          done,
          updated_since,
          updated_until,
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "pipedrive_get_activity",
    {
      description: "Get one activity by id.",
      inputSchema: {
        activity_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ activity_id }) => jsonResult(await client.get(`/api/v2/activities/${activity_id}`)),
  );

  server.registerTool(
    "pipedrive_list_activity_types",
    {
      description: "List configured Pipedrive activity types.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => jsonResult(await client.get("/api/v1/activityTypes")),
  );

  server.registerTool(
    "pipedrive_get_current_user",
    {
      description: "Get the current Pipedrive API user.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => jsonResult(await client.get("/api/v1/users/me")),
  );

  server.registerTool(
    "pipedrive_list_users",
    {
      description: "List Pipedrive users visible to the current API user.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => jsonResult(await client.get("/api/v1/users")),
  );

  server.registerTool(
    "pipedrive_list_notes",
    {
      description: "List notes, optionally scoped to a deal, person, organization or lead.",
      inputSchema: {
        user_id: z.number().int().positive().optional(),
        lead_id: z.string().uuid().optional(),
        deal_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        ...startPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v1/notes", args)),
  );

  server.registerTool(
    "pipedrive_get_note",
    {
      description: "Get one note by id.",
      inputSchema: {
        note_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ note_id }) => jsonResult(await client.get(`/api/v1/notes/${note_id}`)),
  );

  server.registerTool(
    "pipedrive_list_deal_fields",
    {
      description: "List deal fields, including custom-field keys.",
      inputSchema: {
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/dealFields", args)),
  );

  server.registerTool(
    "pipedrive_list_person_fields",
    {
      description: "List person fields, including custom-field keys.",
      inputSchema: {
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/personFields", args)),
  );

  server.registerTool(
    "pipedrive_list_organization_fields",
    {
      description: "List organization fields, including custom-field keys.",
      inputSchema: {
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/organizationFields", args)),
  );

  server.registerTool(
    "pipedrive_create_activity",
    {
      description:
        "Create an activity only when writes are enabled. Defaults to dry-run for safe review.",
      inputSchema: {
        subject: z.string().min(1),
        type: z.string().default("task"),
        deal_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        due_date: z.string().optional(),
        note: z.string().optional(),
        dry_run: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      if (args.dry_run || !config.enableWrites) {
        return jsonResult({
          dry_run: true,
          dry_run_reason: args.dry_run ? "explicit" : "writes_disabled",
          writes_enabled: config.enableWrites,
          would_create: args,
        });
      }
      return jsonResult(await client.post("/api/v1/activities", args));
    },
  );

  return server;
}

export function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
