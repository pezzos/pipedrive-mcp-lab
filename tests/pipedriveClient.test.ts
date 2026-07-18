import assert from "node:assert/strict";
import test from "node:test";
import { PipedriveClient } from "../src/pipedriveClient.js";

test("calls an injected fetcher without rebinding its runtime receiver", async () => {
  const receiverSensitiveFetcher = async function (this: unknown): Promise<Response> {
    if (this !== undefined) {
      throw new TypeError("Illegal invocation: function called with incorrect this reference");
    }
    return Response.json({ success: true, data: [] });
  } as typeof fetch;

  const client = new PipedriveClient(config(), receiverSensitiveFetcher);

  assert.deepEqual(await client.get("/api/v2/deals"), { success: true, data: [] });
});

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
      baseUrlSource: "company_domain",
      enableWrites: false,
      enableDeleteTools: false,
      enableMailboxTools: false,
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
      baseUrlSource: "company_domain",
      enableWrites: false,
      enableDeleteTools: false,
      enableMailboxTools: false,
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
      baseUrlSource: "company_domain",
      enableWrites: false,
      enableDeleteTools: false,
      enableMailboxTools: false,
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
      baseUrlSource: "company_domain",
      enableWrites: false,
      enableDeleteTools: false,
      enableMailboxTools: false,
      requestTimeoutMs: 10000,
    },
    fetchMock,
  );

  await client.putForm("/api/v1/mailbox/mailThreads/9", { deal_id: 123 });
  assert.equal(requestedContentType, "application/x-www-form-urlencoded");
  assert.equal(requestedBody, "deal_id=123");
});

test("redacts echoed bearer tokens from API error messages", async () => {
  const fetchMock = (async () =>
    new Response(JSON.stringify({ error: "Authorization: Bearer oauth-secret-token" }), { status: 401 })) as typeof fetch;

  const client = new PipedriveClient(
    {
      accessToken: "oauth-secret-token",
      companyDomain: "acme",
      baseUrl: "https://acme.pipedrive.com",
      baseUrlSource: "company_domain",
      enableWrites: false,
      enableDeleteTools: false,
      enableMailboxTools: false,
      requestTimeoutMs: 10000,
    },
    fetchMock,
  );

  await assert.rejects(() => client.get("/api/v2/deals"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Authorization: Bearer \[redacted\]/);
    assert.doesNotMatch(error.message, /oauth-secret-token/);
    return true;
  });
});

test("redacts generic secret markers from API error messages", async () => {
  const fetchMock = (async () =>
    new Response(JSON.stringify({
      error: 'request failed: {"api_token":"test-token","client_secret":"very-secret"}',
    }), { status: 401 })) as typeof fetch;

  const client = new PipedriveClient(
    {
      apiToken: "test-token",
      companyDomain: "acme",
      baseUrl: "https://acme.pipedrive.com",
      baseUrlSource: "company_domain",
      enableWrites: false,
      enableDeleteTools: false,
      enableMailboxTools: false,
      requestTimeoutMs: 10000,
    },
    fetchMock,
  );

  await assert.rejects(() => client.get("/api/v2/deals"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /api_token\":\"\[redacted\]/);
    assert.match(error.message, /client_secret\":\"\[redacted\]/);
    assert.doesNotMatch(error.message, /test-token|very-secret/);
    return true;
  });
});

test("applies the request timeout while reading the response body", async () => {
  const fetchMock = (async (_url: URL, init?: RequestInit) => {
    const stream = new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
  const client = new PipedriveClient(config({ requestTimeoutMs: 10 }), fetchMock);

  await assert.rejects(() => client.get("/api/v2/deals"), /timed out/);
});

test("retries transient GET responses and transport failures", async () => {
  let transientAttempts = 0;
  const transientFetch = (async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) {
      return new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  const transientClient = new PipedriveClient(config(), transientFetch);
  assert.deepEqual(await transientClient.get("/api/v2/deals"), { success: true });
  assert.equal(transientAttempts, 2);

  let networkAttempts = 0;
  const networkFetch = (async () => {
    networkAttempts += 1;
    if (networkAttempts === 1) {
      throw new TypeError("temporary network failure");
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  const networkClient = new PipedriveClient(config(), networkFetch);
  assert.deepEqual(await networkClient.get("/api/v2/deals"), { success: true });
  assert.equal(networkAttempts, 2);
});

test("honors a numeric Retry-After delay before retrying a GET", async () => {
  let attempts = 0;
  const fetchMock = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "0.001" },
      });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  const client = new PipedriveClient(config(), fetchMock);

  assert.deepEqual(await client.get("/api/v2/deals"), { success: true });
  assert.equal(attempts, 2);
});

test("does not retry before a Retry-After delay above the safe MCP wait", async () => {
  let attempts = 0;
  const fetchMock = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: { "retry-after": "30" },
    });
  }) as typeof fetch;
  const client = new PipedriveClient(config(), fetchMock);

  await assert.rejects(() => client.get("/api/v2/deals"), /429/);
  assert.equal(attempts, 1);
});

test("falls back to bounded backoff for an invalid Retry-After header", async () => {
  let attempts = 0;
  const fetchMock = (async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "not-a-delay" },
      });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }) as typeof fetch;
  const client = new PipedriveClient(config(), fetchMock);

  assert.deepEqual(await client.get("/api/v2/deals"), { success: true });
  assert.equal(attempts, 2);
});

test("stops after three attempts for a persistently transient GET failure", async () => {
  let attempts = 0;
  const fetchMock = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 });
  }) as typeof fetch;
  const client = new PipedriveClient(config(), fetchMock);

  await assert.rejects(() => client.get("/api/v2/deals"), /503/);
  assert.equal(attempts, 3);
});

test("stops after three attempts for a persistent GET transport failure", async () => {
  let attempts = 0;
  const fetchMock = (async () => {
    attempts += 1;
    throw new TypeError("persistent network failure");
  }) as typeof fetch;
  const client = new PipedriveClient(config(), fetchMock);

  await assert.rejects(() => client.get("/api/v2/deals"), /persistent network failure/);
  assert.equal(attempts, 3);
});

test("does not retry write requests automatically", async () => {
  let attempts = 0;
  const fetchMock = (async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: "temporarily unavailable" }), { status: 503 });
  }) as typeof fetch;
  const client = new PipedriveClient(config(), fetchMock);

  await assert.rejects(() => client.post("/api/v2/deals", { title: "Deal" }), /503/);
  assert.equal(attempts, 1);
});

function config(overrides: Record<string, unknown> = {}) {
  return {
    apiToken: "test-token",
    companyDomain: "acme",
    baseUrl: "https://acme.pipedrive.com",
    baseUrlSource: "company_domain" as const,
    enableWrites: false,
    enableDeleteTools: false,
    enableMailboxTools: false,
    requestTimeoutMs: 10000,
    ...overrides,
  };
}
