import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { PipedriveConfig } from "./config.js";
import { PipedriveClient } from "./pipedriveClient.js";

const pipedriveDateTime = z.string().datetime({ offset: true });
const pipedriveDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Expected YYYY-MM-DD");
const pipedriveTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");
const shortText = z.string().min(1).max(255);
const optionalShortText = z.string().min(1).max(255).optional();
const noteText = z.string().min(1).max(100_000);
const activityNote = z.string().max(10_000).optional();
const moneyValue = z.number().min(0).optional();
const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Expected ISO 4217 currency code").optional();
const customFieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const customFields = z.record(z.string().min(1), customFieldValue).optional();

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

const writeGuardSchema = {
  dry_run: z.boolean().default(true),
  confirmation: z.string().optional(),
};

function assertWriteAllowed(config: PipedriveConfig, dryRun: boolean, confirmation?: string) {
  if (dryRun) {
    return;
  }
  if (!config.enableWrites) {
    throw new Error("PIPEDRIVE_ENABLE_WRITES must be true for real write operations");
  }
  if (confirmation !== config.writeConfirmation) {
    throw new Error("Write confirmation did not match PIPEDRIVE_WRITE_CONFIRMATION");
  }
}

function guardedWriteResult(config: PipedriveConfig, args: { dry_run?: boolean; confirmation?: string }, body: unknown) {
  const dryRun = args.dry_run ?? true;
  if (dryRun || !config.enableWrites) {
    return jsonResult({
      dry_run: true,
      dry_run_reason: dryRun ? "explicit" : "writes_disabled",
      writes_enabled: config.enableWrites,
      would_send: body,
    });
  }
  assertWriteAllowed(config, dryRun, args.confirmation);
  return undefined;
}

function withCustomFields<T extends Record<string, unknown>>(body: T, fields?: Record<string, unknown>) {
  return fields ? { ...body, ...fields } : body;
}

function requireLeadLink(personId?: number, organizationId?: number) {
  if (!personId && !organizationId) {
    throw new Error("Pipedrive leads must be linked to a person_id or organization_id");
  }
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
        mock_base_url_allowed: config.allowMockBaseUrl,
        writes_enabled: config.enableWrites,
        write_confirmation_configured: Boolean(config.writeConfirmation),
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
    "pipedrive_find_deals",
    {
      description: "Search deals by title, notes or custom fields, with optional person and organization filters.",
      inputSchema: {
        term: z.string().min(2),
        fields: z.array(z.enum(["custom_fields", "notes", "title"])).min(1).max(3).optional(),
        exact_match: z.boolean().optional(),
        person_id: z.number().int().positive().optional(),
        organization_id: z.number().int().positive().optional(),
        status: z.enum(["open", "won", "lost"]).optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ term, fields, exact_match, person_id, organization_id, status, limit, cursor }) =>
      jsonResult(
        await client.get("/api/v2/deals/search", {
          term,
          fields: commaList(fields),
          exact_match,
          person_id,
          organization_id,
          status,
          limit,
          cursor,
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
        subject: shortText,
        type: z.string().max(80).default("task"),
        deal_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        lead_id: z.string().uuid().optional(),
        due_date: pipedriveDate.optional(),
        due_time: pipedriveTime.optional(),
        duration: pipedriveTime.optional(),
        busy_flag: z.boolean().optional(),
        note: activityNote,
        ...writeGuardSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ dry_run, confirmation, ...body }) => {
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, body);
      return dryRunResult ?? jsonResult(await client.post("/api/v2/activities", body));
    },
  );

  server.registerTool(
    "pipedrive_create_deal",
    {
      description: "Create a deal. Defaults to dry-run and requires write confirmation for real execution.",
      inputSchema: {
        title: shortText,
        value: moneyValue,
        currency: currencyCode,
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        pipeline_id: z.number().int().positive().optional(),
        stage_id: z.number().int().positive().optional(),
        owner_id: z.number().int().positive().optional(),
        expected_close_date: pipedriveDate.optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, confirmation, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.post("/api/v2/deals", payload));
    },
  );

  server.registerTool(
    "pipedrive_update_deal",
    {
      description: "Update deal fields such as title, value, owner, stage or custom fields.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        title: optionalShortText,
        value: moneyValue,
        currency: currencyCode,
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        pipeline_id: z.number().int().positive().optional(),
        stage_id: z.number().int().positive().optional(),
        owner_id: z.number().int().positive().optional(),
        expected_close_date: pipedriveDate.optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, dry_run, confirmation, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_move_deal_stage",
    {
      description: "Move a deal to another pipeline stage.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        stage_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, stage_id, dry_run, confirmation }) => {
      const payload = { stage_id };
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_mark_deal_won",
    {
      description: "Mark a deal as won.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        close_time: pipedriveDateTime.optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, close_time, dry_run, confirmation }) => {
      const payload = { status: "won", close_time };
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_mark_deal_lost",
    {
      description: "Mark a deal as lost with an optional lost reason.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        lost_reason: z.string().max(500).optional(),
        close_time: pipedriveDateTime.optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, lost_reason, close_time, dry_run, confirmation }) => {
      const payload = { status: "lost", lost_reason, close_time };
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_create_person",
    {
      description: "Create a contact person.",
      inputSchema: {
        name: shortText,
        owner_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        email: z.string().email().optional(),
        phone: z.string().min(3).max(80).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, confirmation, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.post("/api/v2/persons", payload));
    },
  );

  server.registerTool(
    "pipedrive_update_person",
    {
      description: "Update a contact person.",
      inputSchema: {
        person_id: z.number().int().positive(),
        name: optionalShortText,
        owner_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        email: z.string().email().optional(),
        phone: z.string().min(3).max(80).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ person_id, dry_run, confirmation, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/persons/${person_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_create_organization",
    {
      description: "Create an organization.",
      inputSchema: {
        name: shortText,
        owner_id: z.number().int().positive().optional(),
        address: z.string().max(500).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, confirmation, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.post("/api/v2/organizations", payload));
    },
  );

  server.registerTool(
    "pipedrive_update_organization",
    {
      description: "Update an organization.",
      inputSchema: {
        organization_id: z.number().int().positive(),
        name: optionalShortText,
        owner_id: z.number().int().positive().optional(),
        address: z.string().max(500).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ organization_id, dry_run, confirmation, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/organizations/${organization_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_create_lead",
    {
      description: "Create a lead in Leads Inbox.",
      inputSchema: {
        title: shortText,
        owner_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        organization_id: z.number().int().positive().optional(),
        value: moneyValue,
        currency: currencyCode,
        expected_close_date: pipedriveDate.optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, confirmation, custom_fields, organization_id, person_id, ...body }) => {
      requireLeadLink(person_id, organization_id);
      const payload = withCustomFields({ ...body, person_id, org_id: organization_id }, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.post("/api/v1/leads", payload));
    },
  );

  server.registerTool(
    "pipedrive_update_lead",
    {
      description: "Update a lead in Leads Inbox.",
      inputSchema: {
        lead_id: z.string().uuid(),
        title: optionalShortText,
        owner_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        organization_id: z.number().int().positive().optional(),
        value: moneyValue,
        currency: currencyCode,
        expected_close_date: pipedriveDate.optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ lead_id, dry_run, confirmation, custom_fields, organization_id, ...body }) => {
      const payload = withCustomFields({ ...body, org_id: organization_id }, custom_fields);
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v1/leads/${lead_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_convert_lead_to_deal",
    {
      description: "Convert a lead to a deal. Pipedrive returns a conversion job id.",
      inputSchema: {
        lead_id: z.string().uuid(),
        pipeline_id: z.number().int().positive().optional(),
        stage_id: z.number().int().positive().optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ lead_id, dry_run, confirmation, pipeline_id, stage_id }) => {
      const payload = { pipeline_id, stage_id };
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.post(`/api/v2/leads/${lead_id}/convert/deal`, payload));
    },
  );

  server.registerTool(
    "pipedrive_create_note",
    {
      description: "Create a note linked to a deal, lead, person or organization.",
      inputSchema: {
        content: noteText,
        deal_id: z.number().int().positive().optional(),
        lead_id: z.string().uuid().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, confirmation, ...body }) => {
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, body);
      return dryRunResult ?? jsonResult(await client.post("/api/v1/notes", body));
    },
  );

  server.registerTool(
    "pipedrive_update_note",
    {
      description: "Update a note's content.",
      inputSchema: {
        note_id: z.number().int().positive(),
        content: noteText,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ note_id, dry_run, confirmation, ...body }) => {
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, body);
      return dryRunResult ?? jsonResult(await client.put(`/api/v1/notes/${note_id}`, body));
    },
  );

  server.registerTool(
    "pipedrive_update_activity",
    {
      description: "Update or reschedule an activity.",
      inputSchema: {
        activity_id: z.number().int().positive(),
        subject: optionalShortText,
        type: z.string().max(80).optional(),
        deal_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        lead_id: z.string().uuid().optional(),
        due_date: pipedriveDate.optional(),
        due_time: pipedriveTime.optional(),
        duration: pipedriveTime.optional(),
        busy_flag: z.boolean().optional(),
        done: z.boolean().optional(),
        note: activityNote,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ activity_id, dry_run, confirmation, ...body }) => {
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, body);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/activities/${activity_id}`, body));
    },
  );

  server.registerTool(
    "pipedrive_mark_activity_done",
    {
      description: "Mark an activity as done.",
      inputSchema: {
        activity_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ activity_id, dry_run, confirmation }) => {
      const payload = { done: true };
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/activities/${activity_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_reschedule_activity",
    {
      description: "Reschedule an activity date, time or duration.",
      inputSchema: {
        activity_id: z.number().int().positive(),
        due_date: pipedriveDate.optional(),
        due_time: pipedriveTime.optional(),
        duration: pipedriveTime.optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ activity_id, dry_run, confirmation, ...body }) => {
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, body);
      return dryRunResult ?? jsonResult(await client.patch(`/api/v2/activities/${activity_id}`, body));
    },
  );

  server.registerTool(
    "pipedrive_log_call_and_schedule_follow_up",
    {
      description:
        "Workflow helper: create a completed call activity and a future follow-up activity. Defaults to dry-run.",
      inputSchema: {
        call_subject: shortText,
        follow_up_subject: shortText,
        deal_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        lead_id: z.string().uuid().optional(),
        call_note: activityNote,
        follow_up_note: activityNote,
        call_date: pipedriveDate.optional(),
        follow_up_due_date: pipedriveDate,
        follow_up_due_time: pipedriveTime.optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({
      call_subject,
      follow_up_subject,
      call_note,
      follow_up_note,
      call_date,
      follow_up_due_date,
      follow_up_due_time,
      dry_run,
      confirmation,
      ...linkArgs
    }) => {
      const callBody = {
        subject: call_subject,
        type: "call",
        done: true,
        due_date: call_date,
        note: call_note,
        ...linkArgs,
      };
      const followUpBody = {
        subject: follow_up_subject,
        type: "task",
        due_date: follow_up_due_date,
        due_time: follow_up_due_time,
        note: follow_up_note,
        ...linkArgs,
      };
      const payload = { call: callBody, follow_up: followUpBody };
      const dryRunResult = guardedWriteResult(config, { dry_run, confirmation }, payload);
      if (dryRunResult) {
        return dryRunResult;
      }
      const call = await client.post("/api/v2/activities", callBody);
      const followUp = await client.post("/api/v2/activities", followUpBody);
      return jsonResult({ call, follow_up: followUp });
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
