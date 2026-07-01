import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseLiveLabArgs, runLiveLab } from "../src/liveLab.js";

const baseEnv = {
  PIPEDRIVE_BASE_URL: "http://127.0.0.1:3000",
  PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
  PIPEDRIVE_API_TOKEN: "test-token",
  PIPEDRIVE_ENABLE_WRITES: "true",
  PIPEDRIVE_REQUIRE_LAB_PREFIX: "true",
  PIPEDRIVE_LAB_PREFIX: "MCP LAB -",
};

test("live lab args require prefix, explicit mode, and confirmation flag", () => {
  assert.throws(() => parseLiveLabArgs([]), /--prefix/);
  assert.throws(() => parseLiveLabArgs(["--prefix", "MCP LAB - RUN"]), /dry-run|no-dry-run/);

  assert.deepEqual(parseLiveLabArgs(["--prefix", "MCP LAB - RUN", "--dry-run", "--confirm-live-lab"]), {
    prefix: "MCP LAB - RUN",
    dryRun: true,
    confirmLiveLab: true,
    reportDir: "live-lab-reports",
  });
});

test("live lab refuses to run without the write gate and lab prefix", async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), "pipedrive-live-lab-"));
  await assert.rejects(
    () =>
      runLiveLab(
        {
          prefix: "MCP LAB - RUN",
          dryRun: true,
          confirmLiveLab: true,
          reportDir,
        },
        { ...baseEnv, PIPEDRIVE_ENABLE_WRITES: "false" },
        fetchShouldNotRun,
      ),
    /PIPEDRIVE_ENABLE_WRITES=true/,
  );

  await assert.rejects(
    () =>
      runLiveLab(
        {
          prefix: "NOT LAB - RUN",
          dryRun: true,
          confirmLiveLab: true,
          reportDir,
        },
        baseEnv,
        fetchShouldNotRun,
      ),
    /must start with the configured lab prefix/,
  );
});

test("dry-run writes redacted JSON and Markdown reports without API calls", async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), "pipedrive-live-lab-"));
  const result = await runLiveLab(
    {
      prefix: "MCP LAB - DRY RUN",
      dryRun: true,
      confirmLiveLab: true,
      reportDir,
    },
    baseEnv,
    fetchShouldNotRun,
  );

  assert.equal(result.report.status, "planned");
  assert.equal(result.report.dry_run, true);
  assert.equal(result.report.dry_run_documented, true);
  assert.ok(result.report.operations.some((operation) => operation.name === "organization.create"));
  assert.ok(result.report.operations.some((operation) => operation.name === "deal.close_lost"));
  assert.ok(result.report.operations.every((operation) => operation.status === "planned"));

  const json = await readFile(result.jsonPath, "utf8");
  const markdown = await readFile(result.markdownPath, "utf8");
  assert.match(json, /"dry_run": true/);
  assert.match(markdown, /Pipedrive Live Lab Report/);
  assert.doesNotMatch(json, /test-token/);
});

test("live lab mocked run creates, rereads, updates, closes, deletes, and redacts reports", async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), "pipedrive-live-lab-"));
  const requests: Array<{ method: string; path: string; body: unknown; token: string }> = [];
  const fetchMock = (async (url: URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body.toString()) : null;
    requests.push({
      method: init?.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      body,
      token: new Headers(init?.headers).get("x-api-token") ?? "",
    });
    return new Response(JSON.stringify(responseFor(init?.method ?? "GET", url.pathname, body)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await runLiveLab(
    {
      prefix: "MCP LAB - MOCK LIVE",
      dryRun: false,
      confirmLiveLab: true,
      reportDir,
    },
    baseEnv,
    fetchMock,
  );

  assert.equal(result.report.status, "passed");
  assert.equal(result.report.dry_run, false);
  assert.equal(requests.every((request) => request.token === "test-token"), true);
  assert.equal(requests.every((request) => !request.path.includes("test-token")), true);

  const requestLines = requests.map((request) => `${request.method} ${request.path}`);
  for (const expected of [
    "POST /api/v2/organizations",
    "POST /api/v2/persons",
    "POST /api/v1/leads",
    "POST /api/v2/deals",
    "GET /api/v2/boards",
    "GET /api/v2/phases?board_id=301",
    "POST /api/v2/projects",
    "POST /api/v2/tasks",
    "POST /api/v1/notes",
    "POST /api/v2/activities",
    "PATCH /api/v2/deals/203",
    "DELETE /api/v2/activities/205",
    "DELETE /api/v2/tasks/207",
    "DELETE /api/v2/projects/206",
    "DELETE /api/v1/notes/204",
    "DELETE /api/v1/leads/11111111-1111-4111-8111-111111111111",
    "DELETE /api/v2/deals/203",
    "DELETE /api/v2/persons/202",
    "DELETE /api/v2/organizations/201",
  ]) {
    assert.ok(requestLines.includes(expected), `missing ${expected}`);
  }

  const dealClose = requests.find(
    (request) =>
      request.method === "PATCH" &&
      request.path === "/api/v2/deals/203" &&
      (request.body as { status?: string } | undefined)?.status === "lost",
  );
  assert.equal((dealClose?.body as { status?: string } | undefined)?.status, "lost");

  const taskCreate = requests.find((request) => request.method === "POST" && request.path === "/api/v2/tasks");
  assert.equal((taskCreate?.body as { is_done?: boolean } | undefined)?.is_done, false);
  assert.equal((taskCreate?.body as { is_milestone?: boolean } | undefined)?.is_milestone, false);

  const taskMarkDone = requests.find(
    (request) =>
      request.method === "PATCH" &&
      request.path === "/api/v2/tasks/207" &&
      (request.body as { is_done?: boolean } | undefined)?.is_done === true,
  );
  assert.equal((taskMarkDone?.body as { is_done?: boolean } | undefined)?.is_done, true);

  const json = await readFile(result.jsonPath, "utf8");
  assert.doesNotMatch(json, /test-token/);
  assert.doesNotMatch(json, /pipedrive-mcp-lab\+mcp-lab-mock-live@example.invalid/);
  assert.doesNotMatch(json, /Disposable live lab cleanup/);
  assert.match(json, /"\[redacted\]"/);
});

test("live lab skips project and task subtest when no project board exists", async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), "pipedrive-live-lab-"));
  const fetchMock = (async (url: URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body.toString()) : null;
    if ((init?.method ?? "GET") === "GET" && url.pathname === "/api/v2/boards") {
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(responseFor(init?.method ?? "GET", url.pathname, body)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await runLiveLab(
    {
      prefix: "MCP LAB - MOCK LIVE",
      dryRun: false,
      confirmLiveLab: true,
      reportDir,
    },
    baseEnv,
    fetchMock,
  );

  assert.equal(result.report.status, "passed");
  assert.ok(result.report.operations.some((operation) => operation.name === "project_task.skip" && operation.status === "skipped"));
  assert.equal(result.report.entities.project, undefined);
  assert.equal(result.report.entities.task, undefined);
});

function responseFor(method: string, requestPath: string, body: unknown) {
  if (method === "GET" && requestPath === "/api/v2/boards") {
    return { success: true, data: [{ id: 301, name: "Delivery" }] };
  }
  if (method === "GET" && requestPath === "/api/v2/phases") {
    return { success: true, data: [{ id: 302, name: "Kickoff" }] };
  }
  if (method === "POST" && requestPath === "/api/v2/organizations") {
    return { success: true, data: { id: 201, ...(body as Record<string, unknown>) } };
  }
  if (method === "POST" && requestPath === "/api/v2/persons") {
    return { success: true, data: { id: 202, ...(body as Record<string, unknown>) } };
  }
  if (method === "POST" && requestPath === "/api/v1/leads") {
    return {
      success: true,
      data: { id: "11111111-1111-4111-8111-111111111111", ...(body as Record<string, unknown>) },
    };
  }
  if (method === "POST" && requestPath === "/api/v2/deals") {
    return { success: true, data: { id: 203, ...(body as Record<string, unknown>) } };
  }
  if (method === "POST" && requestPath === "/api/v2/projects") {
    return { success: true, data: { id: 206, ...(body as Record<string, unknown>) } };
  }
  if (method === "POST" && requestPath === "/api/v2/tasks") {
    return { success: true, data: { id: 207, ...(body as Record<string, unknown>) } };
  }
  if (method === "POST" && requestPath === "/api/v1/notes") {
    return { success: true, data: { id: 204, ...(body as Record<string, unknown>) } };
  }
  if (method === "POST" && requestPath === "/api/v2/activities") {
    return { success: true, data: { id: 205, ...(body as Record<string, unknown>) } };
  }
  if (method === "DELETE") {
    return { success: true, data: { id: idFromPath(requestPath), is_deleted: true } };
  }
  if (method === "GET" && requestPath.startsWith("/api/v2/tasks/")) {
    return { success: true, data: { id: idFromPath(requestPath), is_done: true, marked_as_done_time: "2026-05-25T12:00:00Z" } };
  }
  if (method === "PATCH" && requestPath.startsWith("/api/v2/tasks/")) {
    const taskBody = body as Record<string, unknown> | null;
    return {
      success: true,
      data: {
        id: idFromPath(requestPath),
        ...taskBody,
        ...(taskBody?.is_done === true ? { marked_as_done_time: "2026-05-25T12:00:00Z" } : {}),
      },
    };
  }
  if (method === "GET" || method === "PATCH" || method === "PUT") {
    return { success: true, data: { id: idFromPath(requestPath), ...(body as Record<string, unknown> | null) } };
  }
  return { success: true, data: {} };
}

function idFromPath(requestPath: string) {
  const raw = requestPath.split("/").at(-1) ?? "";
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

const fetchShouldNotRun = (async () => {
  throw new Error("fetch should not run");
}) as typeof fetch;
