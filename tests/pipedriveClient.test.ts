import assert from "node:assert/strict";
import test from "node:test";
import { PipedriveClient } from "../src/pipedriveClient.js";

test("adds token as authorization header and query filters without logging the token", async () => {
  let requestedUrl = "";
  let requestedToken = "";
  const fetchMock = (async (url: URL, init?: RequestInit) => {
    requestedUrl = url.toString();
    requestedToken = new Headers(init?.headers).get("x-api-token") ?? "";
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
  }) as typeof fetch;

  const client = new PipedriveClient(
    {
      apiToken: "test-token",
      companyDomain: "acme",
      baseUrl: "https://acme.pipedrive.com",
      enableWrites: false,
      requestTimeoutMs: 10000,
    },
    fetchMock,
  );

  const result = await client.get("/api/v2/deals", { status: "open", limit: 5 });
  assert.deepEqual(result, { success: true, data: [] });
  assert.match(requestedUrl, /\/api\/v2\/deals/);
  assert.doesNotMatch(requestedUrl, /test-token/);
  assert.equal(requestedToken, "test-token");
  assert.match(requestedUrl, /status=open/);
  assert.match(requestedUrl, /limit=5/);
});

test("reports API errors without echoing the token", async () => {
  const fetchMock = (async () =>
    new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })) as typeof fetch;

  const client = new PipedriveClient(
    {
      apiToken: "redacted-token-value",
      companyDomain: "acme",
      baseUrl: "https://acme.pipedrive.com",
      enableWrites: false,
      requestTimeoutMs: 10000,
    },
    fetchMock,
  );

  await assert.rejects(() => client.get("/api/v2/deals"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, /redacted-token-value/);
    return true;
  });
});

test("uses OAuth bearer authorization when an access token is configured", async () => {
  let requestedUrl = "";
  let requestedAuth = "";
  let requestedApiToken = "";
  const fetchMock = (async (url: URL, init?: RequestInit) => {
    requestedUrl = url.toString();
    const headers = new Headers(init?.headers);
    requestedAuth = headers.get("Authorization") ?? "";
    requestedApiToken = headers.get("x-api-token") ?? "";
    return new Response(JSON.stringify({ success: true, data: [] }), { status: 200 });
  }) as typeof fetch;

  const client = new PipedriveClient(
    {
      accessToken: "oauth-secret-token",
      companyDomain: "acme",
      baseUrl: "https://acme.pipedrive.com",
      enableWrites: false,
      requestTimeoutMs: 10000,
    },
    fetchMock,
  );

  await client.get("/api/v1/mailbox/mailThreads", { folder: "inbox", limit: 1 });
  assert.match(requestedUrl, /\/api\/v1\/mailbox\/mailThreads/);
  assert.doesNotMatch(requestedUrl, /oauth-secret-token/);
  assert.equal(requestedAuth, "Bearer oauth-secret-token");
  assert.equal(requestedApiToken, "");
});

test("sends form-encoded PUT bodies when requested", async () => {
  let requestedContentType = "";
  let requestedBody = "";
  const fetchMock = (async (_url: URL, init?: RequestInit) => {
    requestedContentType = new Headers(init?.headers).get("content-type") ?? "";
    requestedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ success: true, data: { id: 1 } }), { status: 200 });
  }) as typeof fetch;

  const client = new PipedriveClient(
    {
      apiToken: "test-token",
      companyDomain: "acme",
      baseUrl: "https://acme.pipedrive.com",
      enableWrites: false,
      requestTimeoutMs: 10000,
    },
    fetchMock,
  );

  await client.putForm("/api/v1/mailbox/mailThreads/9", { deal_id: 123 });
  assert.equal(requestedContentType, "application/x-www-form-urlencoded");
  assert.equal(requestedBody, "deal_id=123");
});
