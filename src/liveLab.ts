#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig, requireConfigured } from "./config.js";
import type { PipedriveConfig } from "./config.js";
import { PipedriveClient } from "./pipedriveClient.js";
import type { FetchLike } from "./pipedriveClient.js";

type EntityName = "activity" | "deal" | "lead" | "note" | "organization" | "person" | "project" | "task";
type OperationStatus = "failed" | "planned" | "skipped" | "success";
type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type LiveLabOptions = {
  prefix: string;
  dryRun: boolean;
  confirmLiveLab: boolean;
  reportDir: string;
};

export type LiveLabOperation = {
  name: string;
  method: HttpMethod;
  path: string;
  status: OperationStatus;
  request?: unknown;
  response?: unknown;
  error?: string;
};

export type LiveLabReport = {
  schema_version: 1;
  generated_at: string;
  status: "failed" | "passed" | "planned";
  dry_run: boolean;
  dry_run_documented: true;
  prefix: string;
  gates: {
    writes_enabled: boolean;
    lab_prefix_required: boolean;
    lab_prefix: string;
    explicit_confirmation: boolean;
    base_url_host: string;
  };
  entities: Partial<Record<EntityName, number | string>>;
  operations: LiveLabOperation[];
  error?: string;
};

type ReportPaths = {
  jsonPath: string;
  markdownPath: string;
};

type RunResult = ReportPaths & {
  report: LiveLabReport;
};

type CreatedRecords = Partial<Record<EntityName, number | string>>;

const defaultReportDir = "live-lab-reports";
const explicitModeMessage = "Pass either --dry-run or --no-dry-run so the live lab mode is documented";

export function parseLiveLabArgs(argv: string[]): LiveLabOptions {
  let prefix = "";
  let dryRun: boolean | undefined;
  let confirmLiveLab = false;
  let reportDir = defaultReportDir;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prefix") {
      prefix = requireValue(argv, (index += 1), "--prefix");
    } else if (arg?.startsWith("--prefix=")) {
      prefix = arg.slice("--prefix=".length);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--no-dry-run") {
      dryRun = false;
    } else if (arg === "--confirm-live-lab") {
      confirmLiveLab = true;
    } else if (arg === "--report-dir") {
      reportDir = requireValue(argv, (index += 1), "--report-dir");
    } else if (arg?.startsWith("--report-dir=")) {
      reportDir = arg.slice("--report-dir=".length);
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!prefix.trim()) {
    throw new Error("Missing required --prefix value");
  }
  if (dryRun === undefined) {
    throw new Error(explicitModeMessage);
  }
  return { prefix: prefix.trim(), dryRun, confirmLiveLab, reportDir };
}

export async function runLiveLab(
  options: LiveLabOptions,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RunResult> {
  const config = loadConfig(env);
  validateLiveLabPreflight(config, options);

  const client = new PipedriveClient(config, fetchImpl);
  const operations: LiveLabOperation[] = [];
  const report = createReport(config, options, operations);
  const created: CreatedRecords = {};
  let runError: Error | undefined;

  try {
    if (options.dryRun) {
      operations.push(...plannedOperations());
      report.status = "planned";
    } else {
      await executeLiveSequence(client, options.prefix, operations, created);
      report.status = "passed";
    }
  } catch (error) {
    runError = toError(error);
    report.status = "failed";
    report.error = safeErrorMessage(runError);
  } finally {
    if (!options.dryRun) {
      await cleanupCreatedRecords(client, operations, created);
    }
    report.entities = { ...created };
  }

  const reportPaths = await writeReports(report, options.reportDir);
  if (runError) {
    const message = `${runError.message}. Redacted reports written to ${reportPaths.jsonPath} and ${reportPaths.markdownPath}`;
    throw Object.assign(new Error(message), { report, ...reportPaths });
  }

  return { report, ...reportPaths };
}

function validateLiveLabPreflight(config: PipedriveConfig, options: LiveLabOptions): void {
  requireConfigured(config);
  if (!config.enableWrites) {
    throw new Error("PIPEDRIVE_ENABLE_WRITES=true is required before the live lab harness can run");
  }
  if (!config.requireLabPrefix) {
    throw new Error("PIPEDRIVE_REQUIRE_LAB_PREFIX must not be disabled for the live lab harness");
  }
  if (!config.labPrefix.trim()) {
    throw new Error("PIPEDRIVE_LAB_PREFIX must be configured");
  }
  if (!options.prefix.startsWith(config.labPrefix)) {
    throw new Error(`--prefix must start with the configured lab prefix ${JSON.stringify(config.labPrefix)}`);
  }
  if (options.prefix.length <= config.labPrefix.length) {
    throw new Error("--prefix must include a unique run suffix after the configured lab prefix");
  }
  if (!options.confirmLiveLab) {
    throw new Error("Pass --confirm-live-lab to confirm this disposable lab run explicitly");
  }
}

async function executeLiveSequence(
  client: PipedriveClient,
  prefix: string,
  operations: LiveLabOperation[],
  created: CreatedRecords,
) {
  const today = new Date().toISOString().slice(0, 10);
  const organization = await request(client, operations, "organization.create", "POST", "/api/v2/organizations", {
    name: label(prefix, "Organization"),
  });
  created.organization = requireId(organization, "organization");
  await request(client, operations, "organization.read.created", "GET", `/api/v2/organizations/${created.organization}`);
  await request(client, operations, "organization.update", "PATCH", `/api/v2/organizations/${created.organization}`, {
    name: label(prefix, "Organization Updated"),
  });
  await request(client, operations, "organization.read.updated", "GET", `/api/v2/organizations/${created.organization}`);

  const person = await request(client, operations, "person.create", "POST", "/api/v2/persons", {
    name: label(prefix, "Person"),
    org_id: created.organization,
    emails: [{ value: syntheticEmail(prefix), primary: true, label: "work" }],
    phones: [{ value: "+33100000000", primary: true, label: "work" }],
  });
  created.person = requireId(person, "person");
  await request(client, operations, "person.read.created", "GET", `/api/v2/persons/${created.person}`);
  await request(client, operations, "person.update", "PATCH", `/api/v2/persons/${created.person}`, {
    name: label(prefix, "Person Updated"),
  });
  await request(client, operations, "person.read.updated", "GET", `/api/v2/persons/${created.person}`);

  const lead = await request(client, operations, "lead.create", "POST", "/api/v1/leads", {
    title: label(prefix, "Lead"),
    person_id: created.person,
    organization_id: created.organization,
    value: { amount: 100, currency: "EUR" },
  });
  created.lead = requireId(lead, "lead");
  await request(client, operations, "lead.read.created", "GET", `/api/v1/leads/${created.lead}`);
  await request(client, operations, "lead.update", "PATCH", `/api/v1/leads/${created.lead}`, {
    title: label(prefix, "Lead Updated"),
  });
  await request(client, operations, "lead.read.updated", "GET", `/api/v1/leads/${created.lead}`);

  const deal = await request(client, operations, "deal.create", "POST", "/api/v2/deals", {
    title: label(prefix, "Deal"),
    person_id: created.person,
    org_id: created.organization,
    value: 250,
    currency: "EUR",
  });
  created.deal = requireId(deal, "deal");
  await request(client, operations, "deal.read.created", "GET", `/api/v2/deals/${created.deal}`);
  await request(client, operations, "deal.update", "PATCH", `/api/v2/deals/${created.deal}`, {
    title: label(prefix, "Deal Updated"),
    value: 300,
    currency: "EUR",
  });
  await request(client, operations, "deal.read.updated", "GET", `/api/v2/deals/${created.deal}`);

  await executeProjectTaskSequence(client, prefix, operations, created, today);

  const note = await request(client, operations, "note.create", "POST", "/api/v1/notes", {
    content: `${label(prefix, "Note")} - disposable live harness note`,
    deal_id: created.deal,
  });
  created.note = requireId(note, "note");
  await request(client, operations, "note.read.created", "GET", `/api/v1/notes/${created.note}`);
  await request(client, operations, "note.update", "PUT", `/api/v1/notes/${created.note}`, {
    content: `${label(prefix, "Note Updated")} - disposable live harness note`,
  });
  await request(client, operations, "note.read.updated", "GET", `/api/v1/notes/${created.note}`);

  const activity = await request(client, operations, "activity.create", "POST", "/api/v2/activities", {
    subject: label(prefix, "Activity"),
    type: "task",
    deal_id: created.deal,
    org_id: created.organization,
    due_date: today,
    participants: [{ person_id: created.person, primary: true }],
  });
  created.activity = requireId(activity, "activity");
  await request(client, operations, "activity.read.created", "GET", `/api/v2/activities/${created.activity}`);
  await request(client, operations, "activity.update", "PATCH", `/api/v2/activities/${created.activity}`, {
    subject: label(prefix, "Activity Updated"),
  });
  await request(client, operations, "activity.mark_done", "PATCH", `/api/v2/activities/${created.activity}`, {
    done: true,
  });
  await request(client, operations, "activity.read.done", "GET", `/api/v2/activities/${created.activity}`);

  await request(client, operations, "deal.close_lost", "PATCH", `/api/v2/deals/${created.deal}`, {
    status: "lost",
    lost_reason: "Disposable live lab cleanup",
    close_time: `${today}T00:00:00Z`,
  });
  await request(client, operations, "deal.read.closed", "GET", `/api/v2/deals/${created.deal}`);
}

async function executeProjectTaskSequence(
  client: PipedriveClient,
  prefix: string,
  operations: LiveLabOperation[],
  created: CreatedRecords,
  today: string,
) {
  const boards = await request(client, operations, "project.board.list", "GET", "/api/v2/boards");
  const boardId = firstId(boards);
  if (boardId === undefined) {
    pushSkipped(operations, "project_task.skip", "GET", "/api/v2/boards", "No project board returned by Pipedrive");
    return;
  }

  const phases = await request(client, operations, "project.phase.list", "GET", `/api/v2/phases?board_id=${boardId}`);
  const phaseId = firstId(phases);
  if (phaseId === undefined) {
    pushSkipped(operations, "project_task.skip", "GET", `/api/v2/phases?board_id=${boardId}`, "No project phase returned by Pipedrive");
    return;
  }

  const project = await request(client, operations, "project.create", "POST", "/api/v2/projects", {
    title: label(prefix, "Project"),
    board_id: boardId,
    phase_id: phaseId,
    description: `${label(prefix, "Project")} - disposable live harness project`,
    deal_ids: created.deal !== undefined ? [created.deal] : undefined,
    person_ids: created.person !== undefined ? [created.person] : undefined,
    org_ids: created.organization !== undefined ? [created.organization] : undefined,
  });
  created.project = requireId(project, "project");
  await request(client, operations, "project.read.created", "GET", `/api/v2/projects/${created.project}`);
  await request(client, operations, "project.update", "PATCH", `/api/v2/projects/${created.project}`, {
    title: label(prefix, "Project Updated"),
  });
  await request(client, operations, "project.read.updated", "GET", `/api/v2/projects/${created.project}`);

  const task = await request(client, operations, "task.create", "POST", "/api/v2/tasks", {
    title: label(prefix, "Task"),
    project_id: created.project,
    description: `${label(prefix, "Task")} - disposable live harness task`,
    is_done: false,
    is_milestone: false,
    due_date: today,
  });
  created.task = requireId(task, "task");
  await request(client, operations, "task.read.created", "GET", `/api/v2/tasks/${created.task}`);
  await request(client, operations, "task.update", "PATCH", `/api/v2/tasks/${created.task}`, {
    title: label(prefix, "Task Updated"),
  });
  await request(client, operations, "task.mark_done", "PATCH", `/api/v2/tasks/${created.task}`, {
    is_done: true,
  });
  const doneTask = await request(client, operations, "task.read.done", "GET", `/api/v2/tasks/${created.task}`);
  assertTaskMarkedDone(doneTask);
}

async function cleanupCreatedRecords(
  client: PipedriveClient,
  operations: LiveLabOperation[],
  created: CreatedRecords,
) {
  const cleanupSteps: Array<[EntityName, string]> = [
    ["activity", "/api/v2/activities"],
    ["task", "/api/v2/tasks"],
    ["project", "/api/v2/projects"],
    ["note", "/api/v1/notes"],
    ["lead", "/api/v1/leads"],
    ["deal", "/api/v2/deals"],
    ["person", "/api/v2/persons"],
    ["organization", "/api/v2/organizations"],
  ];

  for (const [entity, basePath] of cleanupSteps) {
    const id = created[entity];
    if (id === undefined) {
      continue;
    }
    try {
      await request(client, operations, `${entity}.delete`, "DELETE", `${basePath}/${id}`);
    } catch {
      continue;
    }
  }
}

async function request(
  client: PipedriveClient,
  operations: LiveLabOperation[],
  name: string,
  method: HttpMethod,
  requestPath: string,
  body?: unknown,
) {
  const operation: LiveLabOperation = {
    name,
    method,
    path: redactPath(requestPath),
    status: "planned",
    ...(body !== undefined ? { request: redactValue(body) } : {}),
  };

  try {
    const response = await send(client, method, requestPath, body);
    operation.status = "success";
    operation.response = summarizeResponse(response);
    operations.push(operation);
    return response;
  } catch (error) {
    operation.status = "failed";
    operation.error = safeErrorMessage(error);
    operations.push(operation);
    throw error;
  }
}

function pushSkipped(
  operations: LiveLabOperation[],
  name: string,
  method: HttpMethod,
  requestPath: string,
  reason: string,
) {
  operations.push({
    name,
    method,
    path: redactPath(requestPath),
    status: "skipped",
    error: reason,
  });
}

function send(client: PipedriveClient, method: HttpMethod, requestPath: string, body?: unknown) {
  if (method === "GET") {
    return client.get(requestPath);
  }
  if (method === "POST") {
    return client.post(requestPath, body);
  }
  if (method === "PATCH") {
    return client.patch(requestPath, body);
  }
  if (method === "PUT") {
    return client.put(requestPath, body);
  }
  return client.delete(requestPath);
}

function plannedOperations(): LiveLabOperation[] {
  return [
    ["organization.create", "POST", "/api/v2/organizations"],
    ["organization.read.created", "GET", "/api/v2/organizations/{organization_id}"],
    ["organization.update", "PATCH", "/api/v2/organizations/{organization_id}"],
    ["organization.read.updated", "GET", "/api/v2/organizations/{organization_id}"],
    ["person.create", "POST", "/api/v2/persons"],
    ["person.read.created", "GET", "/api/v2/persons/{person_id}"],
    ["person.update", "PATCH", "/api/v2/persons/{person_id}"],
    ["person.read.updated", "GET", "/api/v2/persons/{person_id}"],
    ["lead.create", "POST", "/api/v1/leads"],
    ["lead.read.created", "GET", "/api/v1/leads/{lead_id}"],
    ["lead.update", "PATCH", "/api/v1/leads/{lead_id}"],
    ["lead.read.updated", "GET", "/api/v1/leads/{lead_id}"],
    ["deal.create", "POST", "/api/v2/deals"],
    ["deal.read.created", "GET", "/api/v2/deals/{deal_id}"],
    ["deal.update", "PATCH", "/api/v2/deals/{deal_id}"],
    ["deal.read.updated", "GET", "/api/v2/deals/{deal_id}"],
    ["project.board.list", "GET", "/api/v2/boards"],
    ["project.phase.list", "GET", "/api/v2/phases?board_id={board_id}"],
    ["project.create", "POST", "/api/v2/projects"],
    ["project.read.created", "GET", "/api/v2/projects/{project_id}"],
    ["project.update", "PATCH", "/api/v2/projects/{project_id}"],
    ["project.read.updated", "GET", "/api/v2/projects/{project_id}"],
    ["task.create", "POST", "/api/v2/tasks"],
    ["task.read.created", "GET", "/api/v2/tasks/{task_id}"],
    ["task.update", "PATCH", "/api/v2/tasks/{task_id}"],
    ["task.mark_done", "PATCH", "/api/v2/tasks/{task_id}"],
    ["task.read.done", "GET", "/api/v2/tasks/{task_id}"],
    ["note.create", "POST", "/api/v1/notes"],
    ["note.read.created", "GET", "/api/v1/notes/{note_id}"],
    ["note.update", "PUT", "/api/v1/notes/{note_id}"],
    ["note.read.updated", "GET", "/api/v1/notes/{note_id}"],
    ["activity.create", "POST", "/api/v2/activities"],
    ["activity.read.created", "GET", "/api/v2/activities/{activity_id}"],
    ["activity.update", "PATCH", "/api/v2/activities/{activity_id}"],
    ["activity.mark_done", "PATCH", "/api/v2/activities/{activity_id}"],
    ["activity.read.done", "GET", "/api/v2/activities/{activity_id}"],
    ["deal.close_lost", "PATCH", "/api/v2/deals/{deal_id}"],
    ["deal.read.closed", "GET", "/api/v2/deals/{deal_id}"],
    ["activity.delete", "DELETE", "/api/v2/activities/{activity_id}"],
    ["task.delete", "DELETE", "/api/v2/tasks/{task_id}"],
    ["project.delete", "DELETE", "/api/v2/projects/{project_id}"],
    ["note.delete", "DELETE", "/api/v1/notes/{note_id}"],
    ["lead.delete", "DELETE", "/api/v1/leads/{lead_id}"],
    ["deal.delete", "DELETE", "/api/v2/deals/{deal_id}"],
    ["person.delete", "DELETE", "/api/v2/persons/{person_id}"],
    ["organization.delete", "DELETE", "/api/v2/organizations/{organization_id}"],
  ].map(([name, method, requestPath]) => ({
    name,
    method: method as HttpMethod,
    path: requestPath,
    status: "planned" as const,
  }));
}

function createReport(
  config: PipedriveConfig,
  options: LiveLabOptions,
  operations: LiveLabOperation[],
): LiveLabReport {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status: "planned",
    dry_run: options.dryRun,
    dry_run_documented: true,
    prefix: options.prefix,
    gates: {
      writes_enabled: config.enableWrites,
      lab_prefix_required: config.requireLabPrefix,
      lab_prefix: config.labPrefix,
      explicit_confirmation: options.confirmLiveLab,
      base_url_host: baseUrlHost(config.baseUrl),
    },
    entities: {},
    operations,
  };
}

async function writeReports(report: LiveLabReport, reportDir: string): Promise<ReportPaths> {
  await mkdir(reportDir, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-");
  const basename = `pipedrive-live-lab-${stamp}`;
  const jsonPath = path.resolve(reportDir, `${basename}.json`);
  const markdownPath = path.resolve(reportDir, `${basename}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, renderMarkdownReport(report));
  return { jsonPath, markdownPath };
}

function renderMarkdownReport(report: LiveLabReport): string {
  const lines = [
    "# Pipedrive Live Lab Report",
    "",
    `- generated_at: ${report.generated_at}`,
    `- status: ${report.status}`,
    `- dry_run: ${report.dry_run}`,
    `- dry_run_documented: ${report.dry_run_documented}`,
    `- prefix: ${escapeMarkdown(report.prefix)}`,
    `- base_url_host: ${escapeMarkdown(report.gates.base_url_host)}`,
    `- writes_enabled: ${report.gates.writes_enabled}`,
    `- lab_prefix_required: ${report.gates.lab_prefix_required}`,
    `- explicit_confirmation: ${report.gates.explicit_confirmation}`,
    "",
    "## Entities",
    "",
    ...Object.entries(report.entities).map(([entity, id]) => `- ${entity}: ${id}`),
    "",
    "## Operations",
    "",
    "| # | status | method | path | name |",
    "| --- | --- | --- | --- | --- |",
    ...report.operations.map(
      (operation, index) =>
        `| ${index + 1} | ${operation.status} | ${operation.method} | ${escapeMarkdown(operation.path)} | ${escapeMarkdown(operation.name)} |`,
    ),
    "",
  ];
  if (report.error) {
    lines.push("## Error", "", escapeMarkdown(report.error), "");
  }
  return `${lines.join("\n")}\n`;
}

function summarizeResponse(response: unknown): unknown {
  const data = isRecord(response) ? response.data : undefined;
  if (isRecord(data)) {
    return redactValue({
      success: isRecord(response) ? response.success : undefined,
      id: data.id,
      status: data.status,
      active_flag: data.active_flag,
      is_deleted: data.is_deleted,
      is_done: data.is_done,
      marked_as_done_time: data.marked_as_done_time,
    });
  }
  return redactValue({
    success: isRecord(response) ? response.success : undefined,
    data_type: data === null ? "null" : typeof data,
  });
}

function assertTaskMarkedDone(response: unknown) {
  const data = isRecord(response) ? response.data : undefined;
  if (!isRecord(data) || data.is_done !== true || !data.marked_as_done_time) {
    throw new Error("Pipedrive task mark-done verification failed: expected is_done=true with marked_as_done_time");
  }
}

function requireId(response: unknown, entity: EntityName): number | string {
  const data = isRecord(response) ? response.data : undefined;
  const id = isRecord(data) ? data.id : undefined;
  if (typeof id === "number" || typeof id === "string") {
    return id;
  }
  throw new Error(`Pipedrive ${entity} response did not include data.id`);
}

function firstId(response: unknown): number | string | undefined {
  const data = isRecord(response) ? response.data : undefined;
  const first = Array.isArray(data) ? data[0] : undefined;
  const id = isRecord(first) ? first.id : undefined;
  return typeof id === "number" || typeof id === "string" ? id : undefined;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = shouldRedactKey(key) && entry ? "[redacted]" : redactValue(entry);
  }
  return redacted;
}

function shouldRedactKey(key: string): boolean {
  return /^(content|email|emails|phone|phones|comments|lost_reason)$|note/i.test(key);
}

function redactPath(requestPath: string): string {
  return requestPath.replace(
    /(\/api\/v[12]\/(?:activities|deals|leads|notes|organizations|persons|projects|tasks)\/)[^/?]+/g,
    "$1{id}",
  );
}

function label(prefix: string, suffix: string) {
  return `${prefix} - ${suffix}`.replace(/\s+/g, " ").trim();
}

function syntheticEmail(prefix: string) {
  const slug = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `pipedrive-mcp-lab+${slug || "run"}@example.invalid`;
}

function baseUrlHost(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

function safeErrorMessage(error: unknown) {
  return toError(error).message.replace(/x-api-token:\s*\S+/gi, "x-api-token: [redacted]");
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeMarkdown(value: string) {
  return value.replace(/\|/g, "\\|");
}

function requireValue(argv: string[], index: number, flag: string) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function usage() {
  return [
    "Usage:",
    '  npm run live:lab -- --prefix "MCP LAB - YYYY-MM-DD - RUN-ID" --dry-run --confirm-live-lab',
    '  npm run live:lab -- --prefix "MCP LAB - YYYY-MM-DD - RUN-ID" --no-dry-run --confirm-live-lab',
  ].join("\n");
}

async function main() {
  try {
    const result = await runLiveLab(parseLiveLabArgs(process.argv.slice(2)));
    console.log(`Pipedrive live lab ${result.report.status}.`);
    console.log(`JSON report: ${result.jsonPath}`);
    console.log(`Markdown report: ${result.markdownPath}`);
  } catch (error) {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
