import assert from "node:assert/strict";
import test from "node:test";

import { clearAccessJwksCache } from "../src/remote/access.js";
import type { RemoteEnv } from "../src/remote/env.js";
import worker from "../src/remote/worker.js";

const issuer = "https://team.cloudflareaccess.com";
const audience = "worker-audience";

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
    Response.json({ code: "pipedrive_not_connected" }, { status: 404 }),
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
