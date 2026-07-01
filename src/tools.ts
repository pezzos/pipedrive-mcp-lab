import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { PipedriveConfig } from "./config.js";
import { getRuntimeEnvDiagnostics } from "./env.js";
import { PipedriveClient } from "./pipedriveClient.js";

const pipedriveDateTime = z.string().datetime({ offset: true });
const pipedriveDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Expected YYYY-MM-DD");
const pipedriveCloseTime = z.union([pipedriveDateTime, pipedriveDate]);
const pipedriveTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");
const shortText = z.string().min(1).max(255);
const optionalShortText = z.string().min(1).max(255).optional();
const noteText = z.string().min(1).max(100_000);
const activityNote = z.string().max(10_000).optional();
const longText = z.string().max(65_000).optional();
const moneyValue = z.number().min(0).optional();
const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Expected ISO 4217 currency code").optional();
const contactDetail = z.object({
  value: z.string().min(1).max(255),
  primary: z.boolean().optional(),
  label: z.string().min(1).max(80).optional(),
});
const customFieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const customFields = z.record(z.string().min(1), customFieldValue).optional();
const customFieldKeysSymbol = Symbol("pipedriveCustomFieldKeys");

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
const mailFolder = z.enum(["inbox", "drafts", "sent", "archive"]);

function commaList(values?: string[]) {
  return values?.length ? values.join(",") : undefined;
}

const writeGuardSchema = {
  dry_run: z.boolean().default(true),
  validate_links: z.boolean().default(false),
};

function guardedWriteResult(
  config: PipedriveConfig,
  args: { dry_run?: boolean },
  body: unknown,
  extra: Record<string, unknown> = {},
) {
  const dryRun = args.dry_run ?? true;
  if (dryRun || !config.enableWrites) {
    return jsonResult({
      dry_run: true,
      dry_run_reason: dryRun ? "explicit" : "writes_disabled",
      writes_enabled: config.enableWrites,
      would_send: redactDryRunPayload(body),
      ...extra,
    });
  }
  return undefined;
}

function withCustomFields<T extends Record<string, unknown>>(body: T, fields?: Record<string, unknown>) {
  if (!fields) {
    return body;
  }
  const payload = { ...body, ...fields };
  Object.defineProperty(payload, customFieldKeysSymbol, {
    value: Object.keys(fields),
    enumerable: false,
  });
  return payload;
}

function requireLeadLink(personId?: number, organizationId?: number) {
  if (!personId && !organizationId) {
    throw new Error("Pipedrive leads must be linked to a person_id or organization_id");
  }
}

function requireLeadValueCurrency(value?: number, currency?: string) {
  if (value !== undefined && !currency) {
    throw new Error("Lead value requires a three-letter currency");
  }
}

type LinkRef = {
  type:
    | "activity"
    | "board"
    | "deal"
    | "lead"
    | "note"
    | "organization"
    | "person"
    | "phase"
    | "product"
    | "project"
    | "task";
  id: number | string | undefined;
  path: string;
  labelFields: string[];
};

function normalizeCloseTime(value?: string) {
  return value && pipedriveDate.safeParse(value).success ? `${value}T00:00:00Z` : value;
}

async function validateLinksIfRequested(client: PipedriveClient, validate: boolean, refs: LinkRef[]) {
  if (!validate) {
    return undefined;
  }
  const validated: string[] = [];
  for (const ref of refs) {
    if (ref.id !== undefined) {
      await client.get(ref.path);
      validated.push(`${ref.type}:${ref.id}`);
    }
  }
  return validated.length ? validated : undefined;
}

function dealRef(id?: number): LinkRef {
  return { type: "deal", id, path: `/api/v2/deals/${id}`, labelFields: ["title"] };
}

function personRef(id?: number): LinkRef {
  return { type: "person", id, path: `/api/v2/persons/${id}`, labelFields: ["name"] };
}

function organizationRef(id?: number): LinkRef {
  return { type: "organization", id, path: `/api/v2/organizations/${id}`, labelFields: ["name"] };
}

function leadRef(id?: string): LinkRef {
  return { type: "lead", id, path: `/api/v1/leads/${id}`, labelFields: ["title"] };
}

function activityRef(id?: number): LinkRef {
  return { type: "activity", id, path: `/api/v2/activities/${id}`, labelFields: ["subject"] };
}

function noteRef(id?: number): LinkRef {
  return { type: "note", id, path: `/api/v1/notes/${id}`, labelFields: ["content"] };
}

function productRef(id?: number): LinkRef {
  return { type: "product", id, path: `/api/v2/products/${id}`, labelFields: ["name"] };
}

function projectRef(id?: number): LinkRef {
  return { type: "project", id, path: `/api/v2/projects/${id}`, labelFields: ["title"] };
}

function taskRef(id?: number): LinkRef {
  return { type: "task", id, path: `/api/v2/tasks/${id}`, labelFields: ["title"] };
}

function boardRef(id?: number): LinkRef {
  return { type: "board", id, path: `/api/v2/boards/${id}`, labelFields: ["name"] };
}

function phaseRef(id?: number): LinkRef {
  return { type: "phase", id, path: `/api/v2/phases/${id}`, labelFields: ["name"] };
}

function projectPayload<T extends Record<string, unknown>>(body: T & { custom_fields?: Record<string, unknown> }) {
  const { custom_fields, ...rest } = body;
  return {
    ...rest,
    ...(custom_fields ? { custom_fields } : {}),
  };
}

function taskPayload<T extends Record<string, unknown>>(body: T & { done?: boolean; milestone?: boolean }) {
  const { done, milestone, ...rest } = body;
  return {
    ...rest,
    ...(done !== undefined ? { is_done: done } : {}),
    ...(milestone !== undefined ? { is_milestone: milestone } : {}),
  };
}

function requireTaskMilestoneDueDate(
  body: { milestone?: boolean; due_date?: string },
  existingTask?: unknown,
) {
  if (body.milestone === true && body.due_date === undefined && !findFirstString(existingTask, ["due_date"])) {
    throw new Error("Pipedrive milestone tasks require due_date");
  }
}

function requireOneDefinedField(body: Record<string, unknown>, fields: string[], label: string) {
  if (fields.every((field) => body[field] === undefined)) {
    throw new Error(`${label} requires at least one field: ${fields.join(", ")}`);
  }
}

function normalizeTaskResponse(response: unknown): unknown {
  if (!isRecord(response)) {
    return response;
  }
  return normalizeTaskContainer(response);
}

function normalizeTaskContainer(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTaskContainer(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "is_done" || key === "is_milestone") {
      const normalizedKey = key === "is_done" ? "done" : "milestone";
      normalized[normalizedKey] = isTaskBooleanInt(entry) ? entry === 1 : entry;
    } else if ((key === "done" || key === "milestone") && isTaskBooleanInt(entry)) {
      normalized[key] = entry === 1;
    } else {
      normalized[key] = normalizeTaskContainer(entry);
    }
  }
  return normalized;
}

function isTaskBooleanInt(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function personPayload<T extends Record<string, unknown>>(
  body: T & {
    email?: string;
    phone?: string;
    emails?: Array<{ value: string; primary?: boolean; label?: string }>;
    phones?: Array<{ value: string; primary?: boolean; label?: string }>;
  },
) {
  const { email, phone, emails, phones, ...rest } = body;
  return {
    ...rest,
    ...(emails || email ? { emails: emails ?? [{ value: email, primary: true, label: "work" }] } : {}),
    ...(phones || phone ? { phones: phones ?? [{ value: phone, primary: true, label: "work" }] } : {}),
  };
}

function leadPayload<T extends Record<string, unknown>>(
  body: T & { value?: number; currency?: string; organization_id?: number },
) {
  const { value, currency, ...rest } = body;
  requireLeadValueCurrency(value, currency);
  return {
    ...rest,
    ...(value !== undefined && currency ? { value: { amount: value, currency } } : {}),
  };
}

function activityPayload<T extends Record<string, unknown>>(body: T & { person_id?: number }) {
  const { person_id, ...rest } = body;
  return {
    ...rest,
    ...(person_id ? { participants: [{ person_id, primary: true }] } : {}),
  };
}

function extractData(response: unknown) {
  if (isRecord(response) && isRecord(response.data)) {
    return response.data;
  }
  return response;
}

const notePreservedFields = [
  "lead_id",
  "deal_id",
  "person_id",
  "org_id",
  "project_id",
  "task_id",
  "pinned_to_lead_flag",
  "pinned_to_deal_flag",
  "pinned_to_organization_flag",
  "pinned_to_person_flag",
  "pinned_to_project_flag",
  "pinned_to_task_flag",
] as const;

function preserveExistingNoteFields<T extends Record<string, unknown>>(body: T, existingNote: unknown) {
  const data = extractData(existingNote);
  if (!isRecord(data)) {
    return body;
  }
  const preserved: Record<string, unknown> = {};
  for (const field of notePreservedFields) {
    if (body[field] === undefined && data[field] !== undefined && data[field] !== null) {
      preserved[field] = data[field];
    }
  }
  return { ...preserved, ...body };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function findFirstString(record: unknown, fields: string[]) {
  if (!isRecord(record)) {
    return undefined;
  }
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function redactDryRunPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactDryRunPayload(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  const customFieldKeys = getCustomFieldKeys(value);
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = customFieldKeys.has(key) || isSensitivePayloadField(key)
      ? "[redacted]"
      : key === "custom_fields"
        ? redactCustomFieldValues(entry)
        : redactDryRunPayload(entry);
  }
  return redacted;
}

function isSensitivePayloadField(key: string) {
  return /(^|[_-])(token|secret|password|passwd|api[_-]?key|refresh[_-]?token|access[_-]?token)($|[_-])/i.test(
    key,
  ) || /^(content|email|emails|phone|phones|comments|lost_reason|body|body_html|body_url|snippet|subject|from_address|to_address|from_email|to_email|cc|bcc|reply_to|sender|recipients|attachments|note|notes|note_content)$/i.test(
    key,
  );
}

function redactCustomFieldValues(value: unknown): unknown {
  if (!isRecord(value)) {
    return "[redacted]";
  }
  return Object.fromEntries(Object.keys(value).map((key) => [key, "[redacted]"]));
}

function getCustomFieldKeys(value: Record<string, unknown>) {
  const keys = (value as Record<symbol, unknown>)[customFieldKeysSymbol];
  return new Set(Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : []);
}

function requireExactlyOneMailThreadLink(dealId?: number, leadId?: string) {
  if (dealId && leadId) {
    throw new Error("Mail thread linking accepts either deal_id or lead_id, not both");
  }
  if (!dealId && !leadId) {
    throw new Error("Mail thread linking requires deal_id or lead_id");
  }
}

function mailboxProbeSummary(response: unknown) {
  const topLevelKeys = isRecord(response) ? Object.keys(response).sort() : [];
  const data = isRecord(response) ? response.data : undefined;
  const firstRecord = Array.isArray(data) ? data.find(isRecord) : isRecord(data) ? data : undefined;
  const dataFieldNames = firstRecord ? Object.keys(firstRecord).sort() : [];
  return {
    mailbox_read_ok: true,
    top_level_keys: topLevelKeys,
    data_kind: Array.isArray(data) ? "array" : isRecord(data) ? "object" : typeof data,
    data_count: Array.isArray(data) ? data.length : undefined,
    data_field_names: dataFieldNames,
    sensitive_data_fields_present: dataFieldNames.filter(isSensitivePayloadField),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildServer(config: PipedriveConfig, client = new PipedriveClient(config)) {
  const server = new McpServer({
    name: "pipedrive-mcp",
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
    async () => {
      const envDiagnostics = getRuntimeEnvDiagnostics();
      return jsonResult({
        token_configured: Boolean(config.apiToken || config.accessToken),
        api_token_configured: Boolean(config.apiToken),
        access_token_configured: Boolean(config.accessToken),
        company_domain_configured: Boolean(config.companyDomain),
        base_url_configured: Boolean(config.baseUrl),
        mock_base_url_allowed: config.allowMockBaseUrl,
        writes_enabled: config.enableWrites,
        delete_tools_enabled: config.enableWrites && config.enableDeleteTools,
        mailbox_tools_enabled: config.enableWrites && config.enableMailboxTools,
        request_timeout_ms: config.requestTimeoutMs,
        runtime_env_diagnostics_initialized: envDiagnostics.initialized,
        dotenv_loading_enabled: envDiagnostics.dotenvLoadingEnabled,
        dotenv_local_file_present: envDiagnostics.dotenvLocalFilePresent,
        dotenv_loaded: envDiagnostics.dotenvLoaded,
        runtime_env_preexisting_enable_writes: envDiagnostics.preexisting.enableWrites,
        runtime_env_preexisting_enable_delete_tools: envDiagnostics.preexisting.enableDeleteTools,
        runtime_env_preexisting_enable_mailbox_tools: envDiagnostics.preexisting.enableMailboxTools,
        runtime_env_preexisting_load_dotenv: envDiagnostics.preexisting.loadDotenv,
        runtime_env_current_has_enable_writes: envDiagnostics.current.enableWrites,
        runtime_env_current_has_enable_delete_tools: envDiagnostics.current.enableDeleteTools,
        runtime_env_current_has_enable_mailbox_tools: envDiagnostics.current.enableMailboxTools,
        runtime_env_current_has_load_dotenv: envDiagnostics.current.loadDotenv,
      });
    },
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
    "pipedrive_list_products",
    {
      description: "List products available for deal line items.",
      inputSchema: {
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/products", args)),
  );

  server.registerTool(
    "pipedrive_get_product",
    {
      description: "Get one product by id.",
      inputSchema: {
        product_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ product_id }) => jsonResult(await client.get(`/api/v2/products/${product_id}`)),
  );

  server.registerTool(
    "pipedrive_search_products",
    {
      description: "Search products by term.",
      inputSchema: {
        term: z.string().min(2),
        exact_match: z.boolean().optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/products/search", args)),
  );

  server.registerTool(
    "pipedrive_list_deal_products",
    {
      description: "List products attached to a deal.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ deal_id, ...args }) => jsonResult(await client.get(`/api/v2/deals/${deal_id}/products`, args)),
  );

  server.registerTool(
    "pipedrive_list_deal_participants",
    {
      description: "List participants attached to a deal.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        ...startPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ deal_id, ...args }) => jsonResult(await client.get(`/api/v1/deals/${deal_id}/participants`, args)),
  );

  server.registerTool(
    "pipedrive_list_deal_followers",
    {
      description: "List users following a deal.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ deal_id, ...args }) => jsonResult(await client.get(`/api/v2/deals/${deal_id}/followers`, args)),
  );

  server.registerTool(
    "pipedrive_list_deal_files",
    {
      description: "List files attached to a deal.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        ...startPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ deal_id, ...args }) => jsonResult(await client.get(`/api/v1/deals/${deal_id}/files`, args)),
  );

  if (config.enableWrites && config.enableMailboxTools) {
  server.registerTool(
    "pipedrive_list_deal_mail_messages",
    {
      description: "List mail messages associated with a deal. May include sensitive email metadata.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        ...startPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ deal_id, ...args }) => jsonResult(await client.get(`/api/v1/deals/${deal_id}/mailMessages`, args)),
  );

  server.registerTool(
    "pipedrive_mailbox_probe",
    {
      description:
        "Read-only mailbox access probe. Checks whether the configured Pipedrive credentials can list one inbox thread without returning mail subjects, addresses or bodies.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () =>
      jsonResult(
        mailboxProbeSummary(
          await client.get("/api/v1/mailbox/mailThreads", { folder: "inbox", start: 0, limit: 1 }),
        ),
      ),
  );

  server.registerTool(
    "pipedrive_list_mail_threads",
    {
      description:
        "List Pipedrive mailbox threads in a folder. Results may include sensitive email metadata such as subjects and addresses.",
      inputSchema: {
        folder: mailFolder.default("inbox"),
        ...startPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v1/mailbox/mailThreads", args)),
  );

  server.registerTool(
    "pipedrive_get_mail_thread",
    {
      description:
        "Get one Pipedrive mailbox thread. The response may include sensitive email metadata such as subject and participants.",
      inputSchema: {
        mail_thread_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ mail_thread_id }) => jsonResult(await client.get(`/api/v1/mailbox/mailThreads/${mail_thread_id}`)),
  );

  server.registerTool(
    "pipedrive_list_mail_thread_messages",
    {
      description:
        "List all mail messages inside a Pipedrive mailbox thread. Use pipedrive_get_mail_message with include_body=true only when the message body is needed.",
      inputSchema: {
        mail_thread_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ mail_thread_id }) =>
      jsonResult(await client.get(`/api/v1/mailbox/mailThreads/${mail_thread_id}/mailMessages`)),
  );

  server.registerTool(
    "pipedrive_get_mail_message",
    {
      description:
        "Get one Pipedrive mail message. include_body defaults to false; include_body=true may return sensitive email body content.",
      inputSchema: {
        mail_message_id: z.number().int().positive(),
        include_body: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ mail_message_id, include_body }) =>
      jsonResult(
        await client.get(`/api/v1/mailbox/mailMessages/${mail_message_id}`, {
          include_body: include_body ? 1 : 0,
        }),
      ),
  );

  server.registerTool(
    "pipedrive_link_mail_thread",
    {
      description:
        "Link a Pipedrive mailbox thread to exactly one deal or lead. Defaults to dry-run and does not change read, archive, sharing or deletion state.",
      inputSchema: {
        mail_thread_id: z.number().int().positive(),
        deal_id: z.number().int().positive().optional(),
        lead_id: z.string().uuid().optional(),
        ...writeGuardSchema,
        validate_links: z.boolean().default(true),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ mail_thread_id, deal_id, lead_id, dry_run, validate_links }) => {
      requireExactlyOneMailThreadLink(deal_id, lead_id);
      const payload = { deal_id, lead_id };
      const refs = [dealRef(deal_id), leadRef(lead_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const writeGate = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (writeGate) {
        return writeGate;
      }
      return jsonResult(await client.putForm(`/api/v1/mailbox/mailThreads/${mail_thread_id}`, payload));
    },
  );
  }

  server.registerTool(
    "pipedrive_list_project_boards",
    {
      description: "List active Pipedrive project boards. Project board endpoints are beta.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => jsonResult(await client.get("/api/v2/boards")),
  );

  server.registerTool(
    "pipedrive_get_project_board",
    {
      description: "Get one Pipedrive project board by id. Project board endpoints are beta.",
      inputSchema: {
        board_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ board_id }) => jsonResult(await client.get(`/api/v2/boards/${board_id}`)),
  );

  server.registerTool(
    "pipedrive_list_project_phases",
    {
      description: "List active Pipedrive project phases under a board. Project phase endpoints are beta.",
      inputSchema: {
        board_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ board_id }) => jsonResult(await client.get("/api/v2/phases", { board_id })),
  );

  server.registerTool(
    "pipedrive_get_project_phase",
    {
      description: "Get one Pipedrive project phase by id. Project phase endpoints are beta.",
      inputSchema: {
        phase_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ phase_id }) => jsonResult(await client.get(`/api/v2/phases/${phase_id}`)),
  );

  server.registerTool(
    "pipedrive_list_project_templates",
    {
      description: "List Pipedrive project templates.",
      inputSchema: {
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/projectTemplates", args)),
  );

  server.registerTool(
    "pipedrive_get_project_template",
    {
      description: "Get one Pipedrive project template by id.",
      inputSchema: {
        template_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ template_id }) => jsonResult(await client.get(`/api/v2/projectTemplates/${template_id}`)),
  );

  server.registerTool(
    "pipedrive_list_project_fields",
    {
      description: "List Pipedrive project field metadata. Project field endpoints are beta.",
      inputSchema: {
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/projectFields", args)),
  );

  server.registerTool(
    "pipedrive_get_project_field",
    {
      description: "Get one Pipedrive project field by field code. Project field endpoints are beta.",
      inputSchema: {
        field_code: z.string().min(1).max(255),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ field_code }) => jsonResult(await client.get(`/api/v2/projectFields/${field_code}`)),
  );

  server.registerTool(
    "pipedrive_list_projects",
    {
      description: "List non-archived Pipedrive projects with optional filters. Project endpoints are beta.",
      inputSchema: {
        filter_id: z.number().int().positive().optional(),
        status: z.enum(["open", "completed", "canceled", "deleted"]).optional(),
        phase_id: z.number().int().positive().optional(),
        deal_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        org_id: z.number().int().positive().optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/projects", args)),
  );

  server.registerTool(
    "pipedrive_get_project",
    {
      description: "Get one Pipedrive project by id. Project endpoints are beta.",
      inputSchema: {
        project_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ project_id }) => jsonResult(await client.get(`/api/v2/projects/${project_id}`)),
  );

  server.registerTool(
    "pipedrive_search_projects",
    {
      description: "Search projects by title, description, notes or custom fields. Project endpoints are beta.",
      inputSchema: {
        term: z.string().min(2),
        fields: z.array(z.enum(["custom_fields", "notes", "title", "description"])).min(1).max(4).optional(),
        exact_match: z.boolean().optional(),
        person_id: z.number().int().positive().optional(),
        organization_id: z.number().int().positive().optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ term, fields, exact_match, person_id, organization_id, limit, cursor }) =>
      jsonResult(
        await client.get("/api/v2/projects/search", {
          term,
          fields: commaList(fields),
          exact_match,
          person_id,
          organization_id,
          limit,
          cursor,
        }),
      ),
  );

  server.registerTool(
    "pipedrive_list_archived_projects",
    {
      description: "List archived Pipedrive projects. Project endpoints are beta.",
      inputSchema: {
        filter_id: z.number().int().positive().optional(),
        status: z.enum(["open", "completed", "canceled", "deleted"]).optional(),
        phase_id: z.number().int().positive().optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => jsonResult(await client.get("/api/v2/projects/archived", args)),
  );

  server.registerTool(
    "pipedrive_list_tasks",
    {
      description: "List Pipedrive project tasks. Task endpoints are beta.",
      inputSchema: {
        done: z.boolean().optional(),
        milestone: z.boolean().optional(),
        assignee_id: z.number().int().positive().optional(),
        project_id: z.number().int().positive().optional(),
        parent_task_id: z.number().int().positive().optional(),
        ...cursorPagination,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ done, milestone, ...args }) =>
      jsonResult(
        normalizeTaskResponse(
          await client.get("/api/v2/tasks", {
            ...args,
            ...(done !== undefined ? { is_done: done } : {}),
            ...(milestone !== undefined ? { is_milestone: milestone } : {}),
          }),
        ),
      ),
  );

  server.registerTool(
    "pipedrive_get_task",
    {
      description: "Get one Pipedrive project task by id. Task endpoints are beta.",
      inputSchema: {
        task_id: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ task_id }) => jsonResult(normalizeTaskResponse(await client.get(`/api/v2/tasks/${task_id}`))),
  );

  if (config.enableWrites) {
  server.registerTool(
    "pipedrive_create_project",
    {
      description:
        "Create a Pipedrive project container from board_id and phase_id. Use this before creating project tasks; do not use it for task items. template_id is intentionally unsupported in this first slice.",
      inputSchema: {
        title: shortText.describe("Project title."),
        board_id: z.number().int().positive().describe("Project board id, usually discovered with pipedrive_list_project_boards."),
        phase_id: z.number().int().positive().describe("Project phase id, usually discovered with pipedrive_list_project_phases."),
        description: longText.describe("Optional project description."),
        owner_id: z.number().int().positive().optional(),
        start_date: pipedriveDate.optional(),
        end_date: pipedriveDate.optional(),
        deal_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        person_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        org_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        label_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, validate_links, ...body }) => {
      const payload = projectPayload(body);
      const refs = [
        boardRef(body.board_id),
        phaseRef(body.phase_id),
        ...(body.deal_ids ?? []).map((id) => dealRef(id)),
        ...(body.person_ids ?? []).map((id) => personRef(id)),
        ...(body.org_ids ?? []).map((id) => organizationRef(id)),
      ];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post("/api/v2/projects", payload));
    },
  );

  server.registerTool(
    "pipedrive_update_project",
    {
      description:
        "Update a Pipedrive project container. Use board_id or phase_id here to move the project between project board/phase positions; use pipedrive_update_task for task fields.",
      inputSchema: {
        project_id: z.number().int().positive().describe("Existing project id returned by project read/create/search tools."),
        title: optionalShortText.describe("Updated project title."),
        board_id: z.number().int().positive().optional().describe("Optional project board id; not valid for task updates."),
        phase_id: z.number().int().positive().optional().describe("Optional project phase id; not valid for task updates."),
        description: longText.describe("Optional project description."),
        owner_id: z.number().int().positive().optional(),
        start_date: pipedriveDate.optional(),
        end_date: pipedriveDate.optional(),
        deal_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        person_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        org_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        label_ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ project_id, dry_run, validate_links, ...body }) => {
      const payload = projectPayload(body);
      const refs = [
        projectRef(project_id),
        boardRef(body.board_id),
        phaseRef(body.phase_id),
        ...(body.deal_ids ?? []).map((id) => dealRef(id)),
        ...(body.person_ids ?? []).map((id) => personRef(id)),
        ...(body.org_ids ?? []).map((id) => organizationRef(id)),
      ];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/projects/${project_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_archive_project",
    {
      description: "Archive a Pipedrive project. Defaults to dry-run.",
      inputSchema: {
        project_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ project_id, dry_run, validate_links }) => {
      const ref = projectRef(project_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { project_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post(`/api/v2/projects/${project_id}/archive`, {}));
    },
  );

  if (config.enableDeleteTools) {
  server.registerTool(
    "pipedrive_delete_project",
    {
      description: "Delete a Pipedrive project. Defaults to dry-run.",
      inputSchema: {
        project_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ project_id, dry_run, validate_links }) => {
      const ref = projectRef(project_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { project_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v2/projects/${project_id}`));
    },
  );
  }

  server.registerTool(
    "pipedrive_create_task",
    {
      description:
        "Create a task inside an existing Pipedrive project. Requires project_id from pipedrive_create_project, pipedrive_list_projects or pipedrive_get_project. Do not pass board_id or phase_id; those belong to pipedrive_create_project.",
      inputSchema: {
        title: shortText.describe("Task title."),
        project_id: z.number().int().positive().describe("Existing parent project id. This is not board_id or phase_id."),
        parent_task_id: z.number().int().positive().optional().describe("Optional parent task id for subtasks."),
        description: longText.describe("Optional task description."),
        done: z.boolean().optional().describe("Whether the task is done. The MCP maps this to Pipedrive is_done."),
        milestone: z.boolean().optional().describe("Whether the task is a milestone. milestone=true requires due_date."),
        due_date: pipedriveDate.optional().describe("Task due date. Required when milestone=true."),
        start_date: pipedriveDate.optional(),
        assignee_id: z.number().int().positive().optional(),
        priority: z.number().int().min(0).optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, validate_links, ...body }) => {
      requireTaskMilestoneDueDate(body);
      const payload = taskPayload(body);
      const refs = [projectRef(body.project_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(normalizeTaskResponse(await client.post("/api/v2/tasks", payload)));
    },
  );

  server.registerTool(
    "pipedrive_update_task",
    {
      description:
        "Update fields on an existing project task. project_id refers to the containing project, not a board or phase; use pipedrive_update_project for board/phase changes.",
      inputSchema: {
        task_id: z.number().int().positive().describe("Existing task id returned by task create/list/get tools."),
        title: optionalShortText.describe("Updated task title."),
        project_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional containing project id. This is not board_id or phase_id; use pipedrive_update_project for board/phase changes."),
        parent_task_id: z.number().int().positive().optional().describe("Optional parent task id for subtasks."),
        description: longText.describe("Optional task description."),
        done: z.boolean().optional().describe("Whether the task is done. The MCP maps this to Pipedrive is_done."),
        milestone: z.boolean().optional().describe("Whether the task is a milestone. milestone=true requires due_date unless the task already has one."),
        due_date: pipedriveDate.optional().describe("Task due date. Required to set milestone=true unless the task already has a due date."),
        start_date: pipedriveDate.optional(),
        assignee_id: z.number().int().positive().optional(),
        priority: z.number().int().min(0).optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ task_id, dry_run, validate_links, ...body }) => {
      const payload = taskPayload(body);
      const refs = [taskRef(task_id), projectRef(body.project_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const milestoneDueDateNeedsRead = body.milestone === true && body.due_date === undefined;
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, {
        validated_links,
        ...(milestoneDueDateNeedsRead && (dry_run ?? true)
          ? { warnings: ["milestone=true without due_date requires the existing task to already have a due_date on real write"] }
          : {}),
      });
      if (dryRunResult) {
        return dryRunResult;
      }
      const existingTask = milestoneDueDateNeedsRead
        ? extractData(await client.get(`/api/v2/tasks/${task_id}`))
        : undefined;
      requireTaskMilestoneDueDate(body, existingTask);
      return jsonResult(normalizeTaskResponse(await client.patch(`/api/v2/tasks/${task_id}`, payload)));
    },
  );

  if (config.enableDeleteTools) {
  server.registerTool(
    "pipedrive_delete_task",
    {
      description: "Delete a Pipedrive project task. Defaults to dry-run.",
      inputSchema: {
        task_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ task_id, dry_run, validate_links }) => {
      const ref = taskRef(task_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { task_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v2/tasks/${task_id}`));
    },
  );
  }

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
    async ({ dry_run, validate_links, ...body }) => {
      const payload = activityPayload(body);
      const refs = [dealRef(body.deal_id), personRef(body.person_id), organizationRef(body.org_id), leadRef(body.lead_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post("/api/v2/activities", payload));
    },
  );

  server.registerTool(
    "pipedrive_create_deal",
    {
      description: "Create a deal. Defaults to dry-run.",
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
    async ({ dry_run, validate_links, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const refs = [personRef(body.person_id), organizationRef(body.org_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post("/api/v2/deals", payload));
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
    async ({ deal_id, dry_run, validate_links, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const refs = [dealRef(deal_id), personRef(body.person_id), organizationRef(body.org_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
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
    async ({ deal_id, stage_id, dry_run, validate_links }) => {
      const payload = { stage_id };
      const refs = [dealRef(deal_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_mark_deal_won",
    {
      description: "Mark a deal as won.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        close_time: pipedriveCloseTime.optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, close_time, dry_run, validate_links }) => {
      const payload = { status: "won", close_time: normalizeCloseTime(close_time) };
      const refs = [dealRef(deal_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_mark_deal_lost",
    {
      description: "Mark a deal as lost with an optional lost reason.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        lost_reason: z.string().max(500).optional(),
        close_time: pipedriveCloseTime.optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, lost_reason, close_time, dry_run, validate_links }) => {
      const payload = { status: "lost", lost_reason, close_time: normalizeCloseTime(close_time) };
      const refs = [dealRef(deal_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/deals/${deal_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_add_product_to_deal",
    {
      description: "Attach one product line item to a deal.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        product_id: z.number().int().positive(),
        item_price: z.number().min(0),
        quantity: z.number().positive(),
        tax: z.number().min(0).optional(),
        comments: z.string().max(500).optional(),
        discount: z.number().min(0).optional(),
        discount_type: z.enum(["amount", "percentage"]).optional(),
        is_enabled: z.boolean().optional(),
        tax_method: z.enum(["exclusive", "inclusive", "none"]).optional(),
        product_variation_id: z.number().int().positive().optional(),
        billing_frequency: z.enum(["one-time", "annually", "semi-annually", "quarterly", "monthly", "weekly"]).optional(),
        billing_frequency_cycles: z.number().int().positive().max(208).optional(),
        billing_start_date: pipedriveDate.optional(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, product_id, dry_run, validate_links, ...body }) => {
      const payload = { product_id, ...body };
      const refs = [dealRef(deal_id), productRef(product_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post(`/api/v2/deals/${deal_id}/products`, payload));
    },
  );

  server.registerTool(
    "pipedrive_add_deal_participant",
    {
      description: "Attach a person as a participant on a deal.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        person_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, person_id, dry_run, validate_links }) => {
      const payload = { person_id };
      const refs = [dealRef(deal_id), personRef(person_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post(`/api/v1/deals/${deal_id}/participants`, payload));
    },
  );

  server.registerTool(
    "pipedrive_add_deal_follower",
    {
      description: "Add a user as a follower on a deal.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        user_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, user_id, dry_run, validate_links }) => {
      const payload = { user_id };
      const refs = [dealRef(deal_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post(`/api/v2/deals/${deal_id}/followers`, payload));
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
        emails: z.array(contactDetail).min(1).max(10).optional(),
        phones: z.array(contactDetail).min(1).max(10).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, validate_links, custom_fields, ...body }) => {
      const payload = withCustomFields(personPayload(body), custom_fields);
      const refs = [organizationRef(body.org_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post("/api/v2/persons", payload));
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
        emails: z.array(contactDetail).min(1).max(10).optional(),
        phones: z.array(contactDetail).min(1).max(10).optional(),
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ person_id, dry_run, validate_links, custom_fields, ...body }) => {
      const payload = withCustomFields(personPayload(body), custom_fields);
      const refs = [personRef(person_id), organizationRef(body.org_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/persons/${person_id}`, payload));
    },
  );

  server.registerTool(
    "pipedrive_create_organization",
    {
      description: "Create an organization.",
      inputSchema: {
        name: shortText,
        owner_id: z.number().int().positive().optional(),
        website: optionalShortText,
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ dry_run, validate_links, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const validated_links = await validateLinksIfRequested(client, validate_links, []);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post("/api/v2/organizations", payload));
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
        website: optionalShortText,
        custom_fields: customFields,
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ organization_id, dry_run, validate_links, custom_fields, ...body }) => {
      const payload = withCustomFields(body, custom_fields);
      const refs = [organizationRef(organization_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/organizations/${organization_id}`, payload));
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
    async ({ dry_run, validate_links, custom_fields, organization_id, person_id, ...body }) => {
      requireLeadLink(person_id, organization_id);
      const payload = withCustomFields(leadPayload({ ...body, person_id, organization_id }), custom_fields);
      const refs = [personRef(person_id), organizationRef(organization_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post("/api/v1/leads", payload));
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
    async ({ lead_id, dry_run, validate_links, custom_fields, organization_id, person_id, ...body }) => {
      const payload = withCustomFields(leadPayload({ ...body, person_id, organization_id }), custom_fields);
      const refs = [leadRef(lead_id), personRef(person_id), organizationRef(organization_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v1/leads/${lead_id}`, payload));
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
    async ({ lead_id, dry_run, validate_links, pipeline_id, stage_id }) => {
      const payload = { pipeline_id, stage_id };
      const refs = [leadRef(lead_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post(`/api/v2/leads/${lead_id}/convert/deal`, payload));
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
    async ({ dry_run, validate_links, ...body }) => {
      const refs = [dealRef(body.deal_id), personRef(body.person_id), organizationRef(body.org_id), leadRef(body.lead_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, body, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.post("/api/v1/notes", body));
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
    async ({ note_id, dry_run, validate_links, ...body }) => {
      const refs = [noteRef(note_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, body, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      const payload = preserveExistingNoteFields(body, await client.get(`/api/v1/notes/${note_id}`));
      return jsonResult(await client.put(`/api/v1/notes/${note_id}`, payload));
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
    async ({ activity_id, dry_run, validate_links, ...body }) => {
      const payload = activityPayload(body);
      const refs = [
        activityRef(activity_id),
        dealRef(body.deal_id),
        personRef(body.person_id),
        organizationRef(body.org_id),
        leadRef(body.lead_id),
      ];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/activities/${activity_id}`, payload));
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
    async ({ activity_id, dry_run, validate_links }) => {
      const payload = { done: true };
      const refs = [activityRef(activity_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/activities/${activity_id}`, payload));
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
    async ({ activity_id, dry_run, validate_links, ...body }) => {
      requireOneDefinedField(body, ["due_date", "due_time", "duration"], "Activity reschedule");
      const refs = [activityRef(activity_id)];
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, body, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.patch(`/api/v2/activities/${activity_id}`, body));
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
      validate_links,
      ...linkArgs
    }) => {
      const refs = [
        dealRef(linkArgs.deal_id),
        personRef(linkArgs.person_id),
        organizationRef(linkArgs.org_id),
        leadRef(linkArgs.lead_id),
      ];
      const callBody = {
        ...activityPayload({
          subject: call_subject,
          type: "call",
          done: true,
          due_date: call_date,
          note: call_note,
          ...linkArgs,
        }),
      };
      const followUpBody = {
        ...activityPayload({
          subject: follow_up_subject,
          type: "task",
          due_date: follow_up_due_date,
          due_time: follow_up_due_time,
          note: follow_up_note,
          ...linkArgs,
        }),
      };
      const payload = { call: callBody, follow_up: followUpBody };
      const validated_links = await validateLinksIfRequested(client, validate_links, refs);
      const dryRunResult = guardedWriteResult(config, { dry_run }, payload, { validated_links });
      if (dryRunResult) {
        return dryRunResult;
      }
      const call = await client.post("/api/v2/activities", callBody);
      let followUp: unknown;
      try {
        followUp = await client.post("/api/v2/activities", followUpBody);
      } catch (error) {
        return jsonResult({
          partial: true,
          call,
          follow_up_error: errorMessage(error),
        });
      }
      return jsonResult({ call, follow_up: followUp });
    },
  );

  if (config.enableDeleteTools) {
  server.registerTool(
    "pipedrive_delete_activity",
    {
      description: "Delete an activity. Defaults to dry-run.",
      inputSchema: {
        activity_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ activity_id, dry_run, validate_links }) => {
      const ref = activityRef(activity_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { activity_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v2/activities/${activity_id}`));
    },
  );
  }

  if (config.enableDeleteTools) {
  server.registerTool(
    "pipedrive_delete_deal",
    {
      description: "Delete a deal. Defaults to dry-run.",
      inputSchema: {
        deal_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ deal_id, dry_run, validate_links }) => {
      const ref = dealRef(deal_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { deal_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v2/deals/${deal_id}`));
    },
  );
  }

  if (config.enableDeleteTools) {
  server.registerTool(
    "pipedrive_delete_lead",
    {
      description: "Delete a lead. Defaults to dry-run.",
      inputSchema: {
        lead_id: z.string().uuid(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ lead_id, dry_run, validate_links }) => {
      const ref = leadRef(lead_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { lead_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v1/leads/${lead_id}`));
    },
  );

  server.registerTool(
    "pipedrive_delete_note",
    {
      description: "Delete a note. Defaults to dry-run.",
      inputSchema: {
        note_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ note_id, dry_run, validate_links }) => {
      const ref = noteRef(note_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { note_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v1/notes/${note_id}`));
    },
  );

  server.registerTool(
    "pipedrive_delete_organization",
    {
      description: "Delete an organization. Defaults to dry-run.",
      inputSchema: {
        organization_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ organization_id, dry_run, validate_links }) => {
      const ref = organizationRef(organization_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { organization_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v2/organizations/${organization_id}`));
    },
  );

  server.registerTool(
    "pipedrive_delete_person",
    {
      description: "Delete a person. Defaults to dry-run.",
      inputSchema: {
        person_id: z.number().int().positive(),
        ...writeGuardSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ person_id, dry_run, validate_links }) => {
      const ref = personRef(person_id);
      const validated_links = await validateLinksIfRequested(client, validate_links, [ref]);
      const dryRunResult = guardedWriteResult(
        config,
        { dry_run },
        { person_id },
        { validated_links },
      );
      if (dryRunResult) {
        return dryRunResult;
      }
      return jsonResult(await client.delete(`/api/v2/persons/${person_id}`));
    },
  );
  }

  }

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
