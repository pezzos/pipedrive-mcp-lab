import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteEnv } from "../src/remote/env.js";
import { defaultUserPolicy, UserPolicyStore, type KeyValueStorage } from "../src/remote/policy.js";
import {
  decryptMaterial,
  encryptMaterial,
  TenantSecrets,
  TenantSecretsCore,
} from "../src/remote/tenantSecrets.js";

test("stores independent permission switches with one-shot CSRF and revision checks", async () => {
  const storage = new MemoryStorage();
  const store = new UserPolicyStore(storage, () => 1_000);
  assert.deepEqual(await store.read(), defaultUserPolicy());
  const csrf = await store.issueCsrf();
  const updated = await store.update(
    { writes: true, deletes: false, mailbox: true, expectedRevision: 0 },
    csrf,
  );
  assert.deepEqual(updated, {
    writes: true,
    deletes: false,
    mailbox: true,
    revision: 1,
    updatedAt: "1970-01-01T00:00:01.000Z",
  });
  await assert.rejects(
    store.update(
      { writes: false, deletes: false, mailbox: false, expectedRevision: 1 },
      csrf,
    ),
    /csrf_invalid/,
  );
});

test("encrypts OAuth material with unique IVs and rejects tampering", async () => {
  const encodedKey = base64Url(Uint8Array.from({ length: 32 }, (_, index) => index));
  const material = {
    accessCredential: "access-fixture",
    refreshCredential: "refresh-fixture",
    expiresAtMs: 123_000,
    apiDomain: "https://acme.pipedrive.com",
  };
  const first = await encryptMaterial(material, encodedKey);
  const second = await encryptMaterial(material, encodedKey);
  assert.notEqual(first.iv, second.iv);
  assert.deepEqual(await decryptMaterial(first, encodedKey), material);
  // The first base64url character always changes data bits; the last can change only ignored padding bits.
  const tamperedCiphertext =
    `${first.ciphertext[0] === "A" ? "B" : "A"}${first.ciphertext.slice(1)}`;
  await assert.rejects(
    decryptMaterial({ ...first, ciphertext: tamperedCiphertext }, encodedKey),
    /oauth_material_invalid/,
  );
  const rotatedKey = base64Url(Uint8Array.from({ length: 32 }, (_, index) => 255 - index));
  await assert.rejects(
    decryptMaterial(first, rotatedKey),
    /oauth_material_invalid/,
  );
});

test("binds OAuth state to the initiating admin and coalesces refresh", async () => {
  let now = 10_000;
  let oauthCalls = 0;
  const storage = new MemoryStorage();
  const core = new TenantSecretsCore(
    storage,
    {
      accessIssuer: "https://team.cloudflareaccess.com",
      accessAudience: "audience",
      adminEmail: "admin@example.com",
      pipedriveClientId: "client-fixture",
      pipedriveClientSecret: "credential-fixture",
      encryptionKey: base64Url(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)),
      auditHmacKey: base64Url(Uint8Array.from({ length: 32 }, (_, index) => index + 1)),
    },
    async (_input, init) => {
      oauthCalls += 1;
      const body = String(init?.body);
      const refreshing = body.includes("refresh_token");
      await Promise.resolve();
      return Response.json({
        access_token: refreshing ? "access-refreshed" : "access-initial",
        refresh_token: "refresh-rotated",
        expires_in: refreshing ? 3_600 : 1,
        api_domain: "https://acme.pipedrive.com",
      });
    },
    () => now,
  );
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  const state = await core.createState("admin-sub", redirectUri);
  await assert.rejects(
    core.exchange("other-sub", state, "code-fixture", redirectUri),
    /oauth_state_invalid/,
  );
  await assert.rejects(
    core.exchange("admin-sub", state, "code-fixture", redirectUri),
    /oauth_state_invalid/,
  );
  const deniedState = await core.createState("admin-sub", redirectUri);
  await core.discardState("admin-sub", deniedState, redirectUri);
  await assert.rejects(
    core.exchange("admin-sub", deniedState, "code-fixture", redirectUri),
    /oauth_state_invalid/,
  );
  const validState = await core.createState("admin-sub", redirectUri);
  await core.exchange("admin-sub", validState, "code-fixture", redirectUri);
  await assert.rejects(
    core.exchange("admin-sub", validState, "code-fixture", redirectUri),
    /oauth_state_invalid/,
  );
  now += 2_000;
  const credentials = await Promise.all([
    core.getCredential(),
    core.getCredential(),
    core.getCredential(),
  ]);
  assert.equal(oauthCalls, 2);
  assert.ok(credentials.every((credential) => credential.accessCredential === "access-refreshed"));
});

test("validates the encryption key before redirect and before consuming OAuth state", async () => {
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  const invalidCore = new TenantSecretsCore(
    new MemoryStorage(),
    remoteConfig({ encryptionKey: "not-a-32-byte-key" }),
  );
  await assert.rejects(
    invalidCore.createState("admin-sub", redirectUri),
    /oauth_encryption_key_invalid/,
  );

  const config = remoteConfig();
  const core = new TenantSecretsCore(
    new MemoryStorage(),
    config,
    async () => validOAuthResponse(),
  );
  const state = await core.createState("admin-sub", redirectUri);
  config.encryptionKey = "invalid-after-state";
  await assert.rejects(
    core.exchange("admin-sub", state, "code-fixture", redirectUri),
    /oauth_encryption_key_invalid/,
  );
  config.encryptionKey = encryptionKey();
  assert.equal(
    (await core.exchange("admin-sub", state, "code-fixture", redirectUri)).accessCredential,
    "access-fixture",
  );
});

test("classifies OAuth provider failures and invalid responses", async () => {
  const cases: Array<{
    name: string;
    fetcher: typeof fetch;
    expected: RegExp;
  }> = [
    {
      name: "network failure",
      fetcher: async () => { throw new Error("provider-canary-secret"); },
      expected: /pipedrive_oauth_unavailable/,
    },
    {
      name: "generic fetch type error",
      fetcher: async () => { throw new TypeError("fetch failed"); },
      expected: /pipedrive_oauth_unavailable/,
    },
    {
      name: "incorrect runtime receiver",
      fetcher: async () => {
        throw new TypeError("Illegal invocation: function called with incorrect this reference");
      },
      expected: /pipedrive_oauth_invocation_failed/,
    },
    {
      name: "invalid success JSON",
      fetcher: async () => new Response("not-json", { status: 200 }),
      expected: /pipedrive_oauth_invalid_response/,
    },
    {
      name: "invalid grant",
      fetcher: async () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      expected: /pipedrive_reconnect_required/,
    },
    {
      name: "null response",
      fetcher: async () => Response.json(null),
      expected: /pipedrive_oauth_invalid_response/,
    },
    {
      name: "hostile API domain",
      fetcher: async () => Response.json({
        access_token: "access-fixture",
        refresh_token: "refresh-fixture",
        expires_in: 3_600,
        api_domain: "https://pipedrive.com.evil.test",
      }),
      expected: /invalid_pipedrive_api_domain/,
    },
  ];
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  for (const scenario of cases) {
    const core = new TenantSecretsCore(
      new MemoryStorage(),
      remoteConfig(),
      scenario.fetcher,
    );
    const state = await core.createState("admin-sub", redirectUri);
    await assert.rejects(
      core.exchange("admin-sub", state, "code-fixture", redirectUri),
      scenario.expected,
      scenario.name,
    );
  }
});

test("calls the injected OAuth fetcher without rebinding its runtime receiver", async () => {
  const receiverSensitiveFetcher = async function (this: unknown): Promise<Response> {
    if (this !== undefined) {
      throw new TypeError("Illegal invocation: function called with incorrect this reference");
    }
    return validOAuthResponse();
  } as typeof fetch;
  const core = new TenantSecretsCore(
    new MemoryStorage(),
    remoteConfig(),
    receiverSensitiveFetcher,
  );
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  const state = await core.createState("admin-sub", redirectUri);
  assert.equal(
    (await core.exchange("admin-sub", state, "code-fixture", redirectUri)).accessCredential,
    "access-fixture",
  );
});

test("rejects state at the exact expiry boundary", async () => {
  let now = 10_000;
  const core = new TenantSecretsCore(
    new MemoryStorage(),
    remoteConfig(),
    async () => validOAuthResponse(),
    () => now,
  );
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  const state = await core.createState("admin-sub", redirectUri);
  now += 10 * 60_000;
  await assert.rejects(
    core.exchange("admin-sub", state, "code-fixture", redirectUri),
    /oauth_state_invalid/,
  );
});

test("classifies Durable Object storage failures", async () => {
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  const putFailure = new TenantSecretsCore(
    new FailingStorage("put"),
    remoteConfig(),
  );
  await assert.rejects(
    putFailure.createState("admin-sub", redirectUri),
    /tenant_storage_unavailable/,
  );

  const getFailure = new TenantSecretsCore(
    new FailingStorage("get"),
    remoteConfig(),
  );
  await assert.rejects(getFailure.getCredential(), /tenant_storage_unavailable/);

  const transactionStorage = new FailingStorage("transaction");
  const transactionFailure = new TenantSecretsCore(
    transactionStorage,
    remoteConfig(),
  );
  const state = await transactionFailure.createState("admin-sub", redirectUri);
  await assert.rejects(
    transactionFailure.exchange("admin-sub", state, "code-fixture", redirectUri),
    /tenant_storage_unavailable/,
  );
});

test("Durable Object HTTP boundary returns only stable allowlisted errors", async () => {
  const malformed = new TenantSecrets(
    durableObjectState(new MemoryStorage()),
    tenantEnv(),
  );
  const malformedResponse = await malformed.fetch(new Request("https://tenant/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json-canary-secret",
  }));
  assert.equal(malformedResponse.status, 400);
  assert.deepEqual(await malformedResponse.json(), { code: "tenant_request_invalid" });

  const invalidKey = new TenantSecrets(
    durableObjectState(new MemoryStorage()),
    tenantEnv({ PIPEDRIVE_OAUTH_ENCRYPTION_KEY: "invalid-key-canary-secret" }),
  );
  const invalidKeyResponse = await invalidKey.fetch(stateRequest());
  assert.equal(invalidKeyResponse.status, 503);
  assert.deepEqual(await invalidKeyResponse.json(), { code: "oauth_encryption_key_invalid" });

  const storageFailure = new TenantSecrets(
    durableObjectState(new FailingStorage("put")),
    tenantEnv(),
  );
  const storageFailureResponse = await storageFailure.fetch(stateRequest());
  assert.equal(storageFailureResponse.status, 503);
  assert.deepEqual(await storageFailureResponse.json(), { code: "tenant_storage_unavailable" });
});

class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async transaction<T>(closure: (transaction: KeyValueStorage) => Promise<T>): Promise<T> {
    return closure(this);
  }
}

class FailingStorage extends MemoryStorage {
  constructor(private readonly operation: "get" | "put" | "transaction") {
    super();
  }

  override async get<T>(key: string): Promise<T | undefined> {
    if (this.operation === "get") {
      throw new Error("storage-get-canary-secret");
    }
    return super.get<T>(key);
  }

  override async put<T>(key: string, value: T): Promise<void> {
    if (this.operation === "put") {
      throw new Error("storage-put-canary-secret");
    }
    return super.put(key, value);
  }

  override async transaction<T>(closure: (transaction: KeyValueStorage) => Promise<T>): Promise<T> {
    if (this.operation === "transaction") {
      throw new Error("storage-transaction-canary-secret");
    }
    return super.transaction(closure);
  }
}

function remoteConfig(overrides: Partial<{
  encryptionKey: string;
}> = {}) {
  return {
    accessIssuer: "https://team.cloudflareaccess.com",
    accessAudience: "audience",
    adminEmail: "admin@example.com",
    pipedriveClientId: "client-fixture",
    pipedriveClientSecret: "credential-fixture",
    encryptionKey: overrides.encryptionKey ?? encryptionKey(),
    auditHmacKey: base64Url(Uint8Array.from({ length: 32 }, (_, index) => index + 1)),
  };
}

function encryptionKey(): string {
  return base64Url(Uint8Array.from({ length: 32 }, (_, index) => 255 - index));
}

function validOAuthResponse(): Response {
  return Response.json({
    access_token: "access-fixture",
    refresh_token: "refresh-fixture",
    expires_in: 3_600,
    api_domain: "https://acme.pipedrive.com",
  });
}

function durableObjectState(storage: KeyValueStorage): DurableObjectState {
  return { storage } as unknown as DurableObjectState;
}

function tenantEnv(overrides: Partial<RemoteEnv> = {}): RemoteEnv {
  return {
    ACCESS_ISSUER: "https://team.cloudflareaccess.com",
    ACCESS_AUD: "audience",
    REMOTE_ADMIN_EMAIL: "admin@example.com",
    PIPEDRIVE_OAUTH_CLIENT_ID: "client-fixture",
    PIPEDRIVE_OAUTH_CLIENT_SECRET: "credential-fixture",
    PIPEDRIVE_OAUTH_ENCRYPTION_KEY: encryptionKey(),
    AUDIT_HMAC_KEY: base64Url(Uint8Array.from({ length: 32 }, (_, index) => index + 1)),
    USER_POLICY: {} as DurableObjectNamespace,
    TENANT_SECRETS: {} as DurableObjectNamespace,
    ...overrides,
  };
}

function stateRequest(): Request {
  return new Request("https://tenant/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      adminSub: "admin-sub",
      redirectUri: "https://mcp.example.test/oauth/pipedrive/callback",
    }),
  });
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
