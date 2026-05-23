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
