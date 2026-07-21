import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteEnv } from "../src/remote/env.js";
import {
  defaultUserPolicy,
  UserPolicyStore,
  type KeyValueOps,
  type KeyValueStorage,
} from "../src/remote/policy.js";
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

test("reads and disconnects a legacy OAuth envelope without exposing secrets", async () => {
  const storage = new MemoryStorage();
  const core = new TenantSecretsCore(storage, remoteConfig(), async () => validOAuthResponse());
  await storage.put("oauth-material", await encryptMaterial({
    accessCredential: "legacy-access-canary",
    refreshCredential: "legacy-refresh-canary",
    expiresAtMs: 123_000,
    apiDomain: "https://legacy.pipedrive.com",
  }, encryptionKey()));

  const status = await core.getStatus();
  assert.deepEqual(status, {
    connected: true,
    materialReadable: true,
    apiDomain: "https://legacy.pipedrive.com",
    expiresAtMs: 123_000,
    connectedAtMs: undefined,
  });
  assert.doesNotMatch(JSON.stringify(status), /legacy-(?:access|refresh)-canary/);

  const view = await core.issueAdminView("admin-sub");
  assert.deepEqual(view.status, status);
  assert.equal((await core.disconnect("admin-sub", view.actionToken)).disconnected, true);
  assert.deepEqual(await core.getStatus(), { connected: false });
  assert.deepEqual(storage.peek("oauth-connection"), { generation: 1 });
  assert.equal(storage.peek("oauth-material"), undefined);
  assert.equal(storage.peek("oauth-state"), undefined);
});

test("keeps the disconnect kill switch available when OAuth material cannot be decrypted", async () => {
  const storage = new MemoryStorage();
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  const connectedCore = new TenantSecretsCore(
    storage,
    remoteConfig(),
    async () => validOAuthResponse(),
  );
  await connect(connectedCore, "connected", redirectUri);

  const brokenKeyCore = new TenantSecretsCore(
    storage,
    remoteConfig({ encryptionKey: "invalid-after-connection" }),
  );
  const view = await brokenKeyCore.issueAdminView("admin-sub");
  assert.deepEqual(view.status, { connected: true, materialReadable: false });
  assert.equal((await brokenKeyCore.disconnect("admin-sub", view.actionToken)).disconnected, true);
  assert.deepEqual(await brokenKeyCore.getStatus(), { connected: false });
});

test("never lets an in-flight refresh overwrite a disconnect and reconnection", async () => {
  let now = 10_000;
  const refreshStarted = deferred<void>();
  const releaseRefresh = deferred<void>();
  const storage = new MemoryStorage();
  const core = new TenantSecretsCore(
    storage,
    remoteConfig(),
    async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "refresh_token") {
        refreshStarted.resolve();
        await releaseRefresh.promise;
        return oauthResponse("stale-refresh", 3_600);
      }
      const code = body.get("code");
      return oauthResponse(code === "replacement" ? "replacement" : "initial", code === "replacement" ? 3_600 : 1);
    },
    () => now,
  );
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  await connect(core, "initial", redirectUri);
  now += 2_000;
  const view = await core.issueAdminView("admin-sub");
  const staleRefresh = core.getCredential();
  await refreshStarted.promise;

  await core.disconnect("admin-sub", view.actionToken);
  await connect(core, "replacement", redirectUri);
  releaseRefresh.resolve();

  await assert.rejects(staleRefresh, /pipedrive_not_connected/);
  assert.equal((await core.getCredential()).accessCredential, "access-replacement");
  assert.equal(JSON.stringify(storage.peek("oauth-material")).includes("stale-refresh"), false);
});

test("never lets an in-flight OAuth callback resurrect a disconnected generation", async () => {
  const oldExchangeStarted = deferred<void>();
  const releaseOldExchange = deferred<void>();
  const storage = new MemoryStorage();
  const core = new TenantSecretsCore(
    storage,
    remoteConfig(),
    async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      const code = body.get("code");
      if (code === "old") {
        oldExchangeStarted.resolve();
        await releaseOldExchange.promise;
      }
      return oauthResponse(code ?? "unknown", 3_600);
    },
  );
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  const oldState = await core.createState("admin-sub", redirectUri);
  const view = await core.issueAdminView("admin-sub");
  const oldExchange = core.exchange("admin-sub", oldState, "old", redirectUri);
  await oldExchangeStarted.promise;

  assert.equal((await core.disconnect("admin-sub", view.actionToken)).disconnected, false);
  await connect(core, "new", redirectUri);
  releaseOldExchange.resolve();

  await assert.rejects(oldExchange, /pipedrive_not_connected/);
  assert.equal((await core.getCredential()).accessCredential, "access-new");
});

test("binds one-shot admin tickets to subject, expiry and connection generation", async () => {
  let now = 50_000;
  const storage = new MemoryStorage();
  const core = new TenantSecretsCore(
    storage,
    remoteConfig(),
    async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      return oauthResponse(body.get("code") ?? "connected", 3_600);
    },
    () => now,
  );
  const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";
  await connect(core, "connected", redirectUri);

  const wrongSubject = await core.issueAdminView("admin-sub");
  await assert.rejects(
    core.disconnect("other-sub", wrongSubject.actionToken),
    /admin_csrf_invalid/,
  );
  await assert.rejects(
    core.disconnect("admin-sub", wrongSubject.actionToken),
    /admin_csrf_invalid/,
  );

  const expired = await core.issueAdminView("admin-sub");
  now += 10 * 60_000;
  await assert.rejects(core.disconnect("admin-sub", expired.actionToken), /admin_csrf_invalid/);

  const stale = await core.issueAdminView("admin-sub");
  await connect(core, "replacement", redirectUri);
  await assert.rejects(core.disconnect("admin-sub", stale.actionToken), /admin_csrf_invalid/);
  assert.equal((await core.getCredential()).accessCredential, "access-replacement");

  const valid = await core.issueAdminView("admin-sub");
  assert.equal((await core.disconnect("admin-sub", valid.actionToken)).disconnected, true);
  await assert.rejects(core.disconnect("admin-sub", valid.actionToken), /admin_csrf_invalid/);
  const idempotent = await core.issueAdminView("admin-sub");
  assert.equal((await core.disconnect("admin-sub", idempotent.actionToken)).disconnected, false);
  assert.deepEqual(storage.peek("oauth-connection"), { generation: 4 });
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
  await assert.rejects(
    transactionFailure.createState("admin-sub", redirectUri),
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
  private transactionTail: Promise<void> = Promise.resolve();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async transaction<T>(closure: (transaction: KeyValueOps) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    const release = deferred<void>();
    this.transactionTail = release.promise;
    await previous;
    const snapshot = new Map(
      Array.from(this.values, ([key, value]) => [key, structuredClone(value)]),
    );
    try {
      return await closure(this);
    } catch (error) {
      this.values.clear();
      for (const [key, value] of snapshot) {
        this.values.set(key, value);
      }
      throw error;
    } finally {
      release.resolve();
    }
  }

  peek(key: string): unknown {
    return this.values.get(key);
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

  override async transaction<T>(closure: (transaction: KeyValueOps) => Promise<T>): Promise<T> {
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

function oauthResponse(label: string, expiresIn: number): Response {
  return Response.json({
    access_token: `access-${label}`,
    refresh_token: `refresh-${label}`,
    expires_in: expiresIn,
    api_domain: "https://acme.pipedrive.com",
  });
}

async function connect(
  core: TenantSecretsCore,
  code: string,
  redirectUri: string,
): Promise<void> {
  const state = await core.createState("admin-sub", redirectUri);
  await core.exchange("admin-sub", state, code, redirectUri);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function durableObjectState(storage: KeyValueStorage): DurableObjectState {
  return { storage } as unknown as DurableObjectState;
}

function tenantEnv(overrides: Partial<RemoteEnv> = {}): RemoteEnv {
  return {
    DEPLOY_ENVIRONMENT: "sandbox",
    PUBLIC_ORIGIN: "https://mcp.example.test",
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
