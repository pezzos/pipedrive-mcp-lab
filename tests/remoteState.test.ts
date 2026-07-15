import assert from "node:assert/strict";
import test from "node:test";

import { defaultUserPolicy, UserPolicyStore, type KeyValueStorage } from "../src/remote/policy.js";
import {
  decryptMaterial,
  encryptMaterial,
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
  await assert.rejects(
    decryptMaterial({ ...first, ciphertext: `${first.ciphertext.slice(0, -1)}A` }, encodedKey),
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

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
