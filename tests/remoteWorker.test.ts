import assert from "node:assert/strict";
import test from "node:test";

import { clearAccessJwksCache } from "../src/remote/access.js";
import type { RemoteEnv } from "../src/remote/env.js";
import worker from "../src/remote/worker.js";

const issuer = "https://team.cloudflareaccess.com";
const audience = "worker-audience";

test("Worker exposes healthz before Access or Pipedrive connection", async () => {
  const response = await worker.fetch(
    new Request("https://mcp.example.test/healthz"),
    remoteEnv(failingNamespace()),
    executionContext().value,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ok",
    transport: "streamable-http",
  });
});

test("Worker audits and rejects a request without an Access assertion", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => logs.push(String(value));
  try {
    const context = executionContext();
    const response = await worker.fetch(
      new Request("https://mcp.example.test/settings"),
      remoteEnv(failingNamespace()),
      context.value,
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { code: "access_token_missing" });
    await Promise.all(context.waits);
    assert.equal(logs.length, 1);
    const event = JSON.parse(logs[0]) as Record<string, unknown>;
    assert.equal(event.operation, "access.verify");
    assert.equal(event.outcome, "denied");
    assert.equal(event.actorId, "anonymous");
  } finally {
    console.log = originalLog;
  }
});

test("Worker rejects a non-admin before touching the OAuth broker", async () => {
  const fixture = await accessFixture("user@example.com");
  await withJwks(fixture.jwk, async () => {
    const response = await worker.fetch(
      authorizedRequest("https://mcp.example.test/admin/pipedrive/connect", fixture.assertion),
      remoteEnv(failingNamespace()),
      executionContext().value,
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: "admin_required" });
  });
});

test("Worker starts Pipedrive OAuth and audits the redirect", async () => {
  const fixture = await accessFixture("admin@example.com");
  const tenantNamespace = namespaceFor(async (request) => {
    assert.equal(new URL(request.url).pathname, "/state");
    const body = await request.json() as { adminSub: string; redirectUri: string };
    assert.equal(body.adminSub, "worker-user-1");
    assert.equal(body.redirectUri, "https://mcp.example.test/oauth/pipedrive/callback");
    return Response.json({ state: "state-fixture" });
  });
  await withJwks(fixture.jwk, async () => {
    const context = executionContext();
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        authorizedRequest(
          "https://mcp.example.test/admin/pipedrive/connect",
          fixture.assertion,
          { headers: { "cf-ray": "connect-ray" } },
        ),
        remoteEnv(failingNamespace(), tenantNamespace),
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.origin, "https://oauth.pipedrive.com");
    assert.equal(location.searchParams.get("client_id"), "client-fixture");
    assert.equal(location.searchParams.get("state"), "state-fixture");
    assert.equal(logs.length, 1);
    const event = JSON.parse(logs[0]) as Record<string, unknown>;
    assert.equal(event.operation, "oauth.connect");
    assert.equal(event.outcome, "success");
    assert.equal(event.httpStatus, 302);
  });
});

test("Worker surfaces and audits an allowlisted OAuth connect failure", async () => {
  const fixture = await accessFixture("admin@example.com");
  const tenantNamespace = namespaceFor(async () =>
    Response.json({ code: "oauth_encryption_key_invalid" }, { status: 503 }),
  );
  await withJwks(fixture.jwk, async () => {
    const context = executionContext();
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        authorizedRequest(
          "https://mcp.example.test/admin/pipedrive/connect",
          fixture.assertion,
          { headers: { "cf-ray": "connect-failure-ray" } },
        ),
        remoteEnv(failingNamespace(), tenantNamespace),
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 503);
    const page = await response.text();
    assert.match(page, /oauth_encryption_key_invalid/);
    assert.match(page, /connect-failure-ray/);
    const event = JSON.parse(logs[0]) as Record<string, unknown>;
    assert.equal(event.outcome, "error");
    assert.equal(event.errorCode, "oauth_encryption_key_invalid");
    assert.equal(event.httpStatus, 503);
  });
});

test("Worker completes the Pipedrive callback and audits success", async () => {
  const fixture = await accessFixture("admin@example.com");
  const tenantNamespace = namespaceFor(async (request) => {
    assert.equal(new URL(request.url).pathname, "/exchange");
    const body = await request.json() as { code: string; state: string };
    assert.equal(body.code, "code-fixture");
    assert.equal(body.state, "state-fixture");
    return Response.json({
      accessCredential: "access-fixture",
      apiDomain: "https://acme.pipedrive.com",
      expiresAtMs: Date.now() + 3_600_000,
    });
  });
  await withJwks(fixture.jwk, async () => {
    const context = executionContext();
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        authorizedRequest(
          "https://mcp.example.test/oauth/pipedrive/callback?code=code-fixture&state=state-fixture",
          fixture.assertion,
          { headers: { "cf-ray": "callback-success-ray" } },
        ),
        remoteEnv(failingNamespace(), tenantNamespace),
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pipedrive est connecté/);
    const event = JSON.parse(logs[0]) as Record<string, unknown>;
    assert.equal(event.operation, "oauth.callback");
    assert.equal(event.outcome, "success");
    assert.equal(event.httpStatus, 200);
  });
});

test("Worker allowlists callback failures without leaking OAuth canaries", async () => {
  const fixture = await accessFixture("admin@example.com");
  const tenantNamespace = namespaceFor(async () =>
    Response.json({ code: "provider-canary-secret-token" }, { status: 502 }),
  );
  await withJwks(fixture.jwk, async () => {
    const context = executionContext();
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        authorizedRequest(
          "https://mcp.example.test/oauth/pipedrive/callback?code=oauth-code-canary&state=oauth-state-canary",
          fixture.assertion,
          { headers: { "cf-ray": "callback-failure-ray" } },
        ),
        remoteEnv(failingNamespace(), tenantNamespace),
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 503);
    const page = await response.text();
    const allOutput = `${page}\n${logs.join("\n")}`;
    assert.match(page, /tenant_internal_error/);
    assert.match(page, /callback-failure-ray/);
    assert.doesNotMatch(allOutput, /provider-canary-secret-token/);
    assert.doesNotMatch(allOutput, /oauth-code-canary/);
    assert.doesNotMatch(allOutput, /oauth-state-canary/);
    const event = JSON.parse(logs[0]) as Record<string, unknown>;
    assert.equal(event.errorCode, "tenant_internal_error");
    assert.equal(event.httpStatus, 503);
  });
});

test("Worker reports an allowlisted invalid state and a denied consent", async () => {
  const fixture = await accessFixture("admin@example.com");
  const invalidStateNamespace = namespaceFor(async () =>
    Response.json({ code: "oauth_state_invalid" }, { status: 400 }),
  );
  await withJwks(fixture.jwk, async () => {
    const invalidContext = executionContext();
    const invalid = await worker.fetch(
      authorizedRequest(
        "https://mcp.example.test/oauth/pipedrive/callback?code=invalid&state=invalid",
        fixture.assertion,
      ),
      remoteEnv(failingNamespace(), invalidStateNamespace),
      invalidContext.value,
    );
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /oauth_state_invalid/);
    await Promise.all(invalidContext.waits);

    let discardedState: Record<string, unknown> | undefined;
    const deniedNamespace = namespaceFor(async (request) => {
      assert.equal(new URL(request.url).pathname, "/state/discard");
      discardedState = await request.json() as Record<string, unknown>;
      return new Response(null, { status: 204 });
    });
    const deniedContext = executionContext();
    const denied = await worker.fetch(
      authorizedRequest(
        "https://mcp.example.test/oauth/pipedrive/callback?error=access_denied&state=denied-state",
        fixture.assertion,
      ),
      remoteEnv(failingNamespace(), deniedNamespace),
      deniedContext.value,
    );
    assert.equal(denied.status, 400);
    assert.match(await denied.text(), /oauth_authorization_denied/);
    assert.deepEqual(discardedState, {
      adminSub: "worker-user-1",
      state: "denied-state",
      redirectUri: "https://mcp.example.test/oauth/pipedrive/callback",
    });
    await Promise.all(deniedContext.waits);
  });
});

test("Worker preserves submitted settings while requesting confirmation", async () => {
  const fixture = await accessFixture("user@example.com");
  const policyNamespace = namespaceFor(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/policy") {
      return Response.json({
        writes: false,
        deletes: false,
        mailbox: false,
        revision: 0,
        updatedAt: "1970-01-01T00:00:00.000Z",
      });
    }
    if (path === "/csrf") {
      return Response.json({ csrf: "csrf-fixture" });
    }
    return new Response("Not found", { status: 404 });
  });
  await withJwks(fixture.jwk, async () => {
    const body = new URLSearchParams({
      writes: "yes",
      mailbox: "yes",
      revision: "0",
      csrf: "csrf-fixture",
    });
    const request = authorizedRequest(
      "https://mcp.example.test/settings",
      fixture.assertion,
      {
        method: "POST",
        headers: {
          origin: "https://mcp.example.test",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    const response = await worker.fetch(
      request,
      remoteEnv(policyNamespace),
      executionContext().value,
    );
    assert.equal(response.status, 400);
    const page = await response.text();
    assert.match(page, /name="writes" value="yes" checked/);
    assert.match(page, /name="mailbox" value="yes" checked/);
    assert.match(page, /Confirmez les conséquences/);
  });
});

test("Worker maps a policy Durable Object failure to a JSON-RPC response", async () => {
  const fixture = await accessFixture("user@example.com");
  const policyNamespace = namespaceFor(async () =>
    Response.json({ code: "storage_failed" }, { status: 500 }),
  );
  await withJwks(fixture.jwk, async () => {
    const response = await worker.fetch(
      authorizedRequest("https://mcp.example.test/mcp", fixture.assertion, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
      remoteEnv(policyNamespace),
      executionContext().value,
    );
    assert.equal(response.status, 503);
    const payload = await response.json() as {
      jsonrpc: string;
      error: { data: { code: string } };
    };
    assert.equal(payload.jsonrpc, "2.0");
    assert.equal(payload.error.data.code, "policy_unavailable");
  });
});

test("Worker fails fast when the admin has not connected Pipedrive", async () => {
  const fixture = await accessFixture("user@example.com");
  const policyNamespace = namespaceFor(async () =>
    Response.json({
      writes: false,
      deletes: false,
      mailbox: false,
      revision: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    }),
  );
  const tenantNamespace = namespaceFor(async () =>
    Response.json({ code: "pipedrive_not_connected" }, { status: 404 }),
  );
  await withJwks(fixture.jwk, async () => {
    const response = await worker.fetch(
      authorizedRequest("https://mcp.example.test/mcp", fixture.assertion, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      }),
      remoteEnv(policyNamespace, tenantNamespace),
      executionContext().value,
    );
    assert.equal(response.status, 503);
    const payload = await response.json() as { error: { data: { code: string } } };
    assert.equal(payload.error.data.code, "pipedrive_not_connected");
  });
});

test("Worker audits a real-write attempt blocked by the user's policy", async () => {
  const fixture = await accessFixture("user@example.com");
  const policyNamespace = namespaceFor(async () =>
    Response.json({
      writes: false,
      deletes: false,
      mailbox: false,
      revision: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    }),
  );
  const tenantNamespace = namespaceFor(async () =>
    Response.json({
      accessCredential: "oauth-access-fixture",
      apiDomain: "https://acme.pipedrive.com",
      expiresAtMs: Date.now() + 60_000,
    }),
  );
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => logs.push(String(value));
  try {
    await withJwks(fixture.jwk, async () => {
      const context = executionContext();
      await worker.fetch(
        authorizedRequest("https://mcp.example.test/mcp", fixture.assertion, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            "mcp-protocol-version": "2025-06-18",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "pipedrive_create_deal",
              arguments: { title: "Blocked", dry_run: false },
            },
          }),
        }),
        remoteEnv(policyNamespace, tenantNamespace),
        context.value,
      );
      await Promise.all(context.waits);
    });
    assert.equal(logs.length, 1);
    const event = JSON.parse(logs[0]) as Record<string, unknown>;
    assert.equal(event.outcome, "denied");
    assert.equal(event.dryRun, true);
    assert.equal(event.errorCode, "writes_disabled");
    assert.equal(String(event.actorId).includes("worker-user-1"), false);
  } finally {
    console.log = originalLog;
  }
});

function remoteEnv(
  policyNamespace: DurableObjectNamespace,
  tenantNamespace: DurableObjectNamespace = failingNamespace(),
): RemoteEnv {
  const oauthClientSecretName = `PIPEDRIVE_OAUTH_CLIENT_${"SECRET"}`;
  const auditKeyName = `AUDIT_HMAC_${"KEY"}`;
  return {
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: audience,
    REMOTE_ADMIN_EMAIL: "admin@example.com",
    PIPEDRIVE_OAUTH_CLIENT_ID: "client-fixture",
    [oauthClientSecretName]: "credential-fixture",
    PIPEDRIVE_OAUTH_ENCRYPTION_KEY: base64Url(
      Uint8Array.from({ length: 32 }, (_, index) => index),
    ),
    [auditKeyName]: base64Url(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)),
    USER_POLICY: policyNamespace,
    TENANT_SECRETS: tenantNamespace,
  } as unknown as RemoteEnv;
}

function namespaceFor(
  handler: (request: Request) => Promise<Response>,
): DurableObjectNamespace {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        handler(new Request(input, init)),
    }),
  } as unknown as DurableObjectNamespace;
}

function failingNamespace(): DurableObjectNamespace {
  return namespaceFor(async () => {
    throw new Error("namespace_should_not_be_called");
  });
}

function executionContext(): { value: ExecutionContext; waits: Promise<unknown>[] } {
  const waits: Promise<unknown>[] = [];
  return {
    waits,
    value: {
      waitUntil: (promise: Promise<unknown>) => waits.push(promise),
      passThroughOnException: () => undefined,
      props: {},
    } as unknown as ExecutionContext,
  };
}

async function captureLogs<T>(run: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (value?: unknown) => logs.push(String(value));
  try {
    return { value: await run(), logs };
  } finally {
    console.log = originalLog;
  }
}

function authorizedRequest(
  url: string,
  assertion: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-jwt-assertion", assertion);
  return new Request(url, { ...init, headers });
}

async function withJwks(jwk: JsonWebKey, run: () => Promise<void>): Promise<void> {
  clearAccessJwksCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [jwk] });
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    clearAccessJwksCache();
  }
}

async function accessFixture(email: string) {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(jwk, { kid: "worker-key", alg: "RS256", use: "sig" });
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: "worker-key" })),
  );
  const payload = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: issuer,
        aud: audience,
        exp: now + 300,
        iat: now,
        nbf: now - 1,
        sub: "worker-user-1",
        email,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return {
    assertion: `${header}.${payload}.${base64Url(new Uint8Array(signature))}`,
    jwk,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
