import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { PipedriveConfig } from "./config.js";
import { PipedriveClient } from "./pipedriveClient.js";

const pipedriveDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Expected YYYY-MM-DD");

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
        pipeline_id: z.number().int().positive().optional(),
        stage_id: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(20),
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
    "pipedrive_search_persons",
    {
      description: "Search persons by term.",
      inputSchema: {
        term: z.string().min(2),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ term, limit }) => jsonResult(await client.get("/api/v1/persons/search", { term, limit })),
  );

  server.registerTool(
    "pipedrive_list_pipelines",
    {
      description: "List Pipedrive pipelines.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => jsonResult(await client.get("/api/v1/pipelines")),
  );

  server.registerTool(
    "pipedrive_list_activities",
    {
      description: "List activities, optionally scoped to a deal or person.",
      inputSchema: {
        deal_id: z.number().int().positive().optional(),
        person_id: z.number().int().positive().optional(),
        since: pipedriveDate.optional(),
        until: pipedriveDate.optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ deal_id, person_id, since, until, limit }) =>
      jsonResult(
        await client.get("/api/v1/activities", {
          deal_id,
          person_id,
          start_date: since,
          end_date: until,
          limit,
        }),
      ),
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
