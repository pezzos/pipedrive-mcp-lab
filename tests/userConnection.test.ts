import assert from "node:assert/strict";
import test from "node:test";

import type { RemoteConfig } from "../src/remote/env.js";
import type { KeyValueOps, KeyValueStorage } from "../src/remote/policy.js";
import type {
  AdminConnectionProjectionInput,
  TenantRecord,
} from "../src/remote/tenantRegistry.js";
import {
  INACTIVE_TOKEN_RETENTION_MS,
  UserConnectionCore,
  type TenantRegistryPort,
} from "../src/remote/userConnection.js";

const redirectUri = "https://mcp.example.test/oauth/pipedrive/callback";

test("connects two users independently and never crosses their material", async () => {
  const tenantA = registry("acme", "company-a", "Tenant A");
  const tenantB = registry("beta", "company-b", "Tenant B");
  const userA = connection(new MemoryStorage(), tenantA, oauthFetcher("acme", "company-a", "Tenant A"));
  const userB = connection(new MemoryStorage(), tenantB, oauthFetcher("beta", "company-b", "Tenant B"));

  await connect(userA, "user-a", "a@example.test", "acme", "code-a");
  await connect(userB, "user-b", "b@example.test", "beta", "code-b");

  const [credentialA, credentialB] = await Promise.all([
    userA.getCredential("user-a"),
    userB.getCredential("user-b"),
  ]);
  assert.equal(credentialA.companyId, "company-a");
  assert.equal(credentialB.companyId, "company-b");
  assert.notEqual(credentialA.accessCredential, credentialB.accessCredential);
  await assert.rejects(userA.getCredential("user-b"), /pipedrive_not_connected/);
  await assert.rejects(userB.getCredential("user-a"), /pipedrive_not_connected/);
});

test("failed replacement preserves the prior connection and a stale callback cannot resurrect it", async () => {
  const tenant = registry("acme", "company-a", "Tenant A");
  const storage = new MemoryStorage();
  const core = connection(storage, tenant, async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/oauth/token") {
      const code = new URLSearchParams(String(init?.body)).get("code");
      return Response.json({
        access_token: code === "bad-domain" ? "bad-access" : `access-${code}`,
        refresh_token: `refresh-${code}`,
        expires_in: 3_600,
        api_domain: code === "bad-domain"
          ? "https://other.pipedrive.com"
          : "https://acme.pipedrive.com",
      });
    }
    return currentUser("company-a", "Tenant A");
  });
  await connect(core, "user-a", "a@example.test", "acme", "first");
  const prior = await core.getCredential("user-a");

  const badState = await core.createState({
    accessSub: "user-a",
    accessEmail: "a@example.test",
    expectedDomain: "acme",
    redirectUri,
    actionToken: await core.issueSelfAction("user-a"),
  });
  await assert.rejects(
    core.exchange({ accessSub: "user-a", state: badState, code: "bad-domain", redirectUri }),
    /tenant_domain_mismatch/,
  );
  assert.equal((await core.getCredential("user-a")).accessCredential, prior.accessCredential);

  const staleState = await core.createState({
    accessSub: "user-a",
    accessEmail: "a@example.test",
    expectedDomain: "acme",
    redirectUri,
    actionToken: await core.issueSelfAction("user-a"),
  });
  const action = await core.issueSelfAction("user-a");
  await core.selfDisconnect("user-a", action);
  await assert.rejects(
    core.exchange({ accessSub: "user-a", state: staleState, code: "late", redirectUri }),
    /oauth_state_invalid|oauth_state_stale/,
  );
  await assert.rejects(core.getCredential("user-a"), /pipedrive_not_connected/);
});

test("fails closed when suspension interleaves callback, refresh, or successful MCP use", async () => {
  let now = 1_000;
  const tenant = registry("acme", "company-a", "Tenant A");
  const storage = new MemoryStorage();
  let suspendDuringRefresh = false;
  const core = connection(storage, tenant, async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/oauth/token") {
      const fields = new URLSearchParams(String(init?.body));
      if (fields.get("grant_type") === "refresh_token" && suspendDuringRefresh) {
        tenant.suspend();
      }
      return Response.json({
        access_token: fields.get("grant_type") === "refresh_token" ? "refreshed" : "initial",
        refresh_token: "refresh",
        expires_in: 1,
        api_domain: "https://acme.pipedrive.com",
      });
    }
    return currentUser("company-a", "Tenant A");
  }, () => now);

  const callbackState = await core.createState({
    accessSub: "user-a",
    accessEmail: "a@example.test",
    expectedDomain: "acme",
    redirectUri,
    actionToken: await core.issueSelfAction("user-a"),
  });
  tenant.suspendAfterNextPin();
  await assert.rejects(
    core.exchange({ accessSub: "user-a", state: callbackState, code: "callback", redirectUri }),
    /tenant_admission_denied/,
  );
  await assert.rejects(core.getCredential("user-a"), /pipedrive_not_connected/);

  tenant.resume();
  await connect(core, "user-a", "a@example.test", "acme", "working");
  now += 120_000;
  suspendDuringRefresh = true;
  await assert.rejects(core.getCredential("user-a"), /tenant_admission_denied/);
  tenant.resume();
  suspendDuringRefresh = false;
  assert.equal((await core.getCredential("user-a")).accessCredential, "refreshed");

  const generation = (await core.getCredential("user-a")).generation;
  tenant.suspend();
  await assert.rejects(core.markUsed("user-a", generation), /tenant_admission_denied/);
});

test("purges at 90 inactive days, retains safe metadata, and reconnects the same pair", async () => {
  let now = 10_000;
  const alarms: number[] = [];
  const tenant = registry("acme", "company-a", "Tenant A");
  const storage = new MemoryStorage();
  const core = connection(
    storage,
    tenant,
    oauthFetcher("acme", "company-a", "Tenant A"),
    () => now,
    alarms,
  );
  await connect(core, "user-a", "a@example.test", "acme", "first");
  const initial = await core.getCredential("user-a");
  await core.markUsed("user-a", initial.generation);

  now += INACTIVE_TOKEN_RETENTION_MS - 1;
  assert.equal(await core.purgeInactive(), false);
  assert.equal(alarms.at(-1), 10_000 + INACTIVE_TOKEN_RETENTION_MS);
  now += 1;
  assert.equal(await core.purgeInactive(), true);
  assert.equal(await storage.get("user-oauth-material:v1"), undefined);
  const purged = await core.getStatus();
  assert.equal(purged.connected, false);
  assert.equal(purged.reconnectRequired, true);
  assert.equal(tenant.projections.at(-1)?.state, "reconnect-required");
  await assert.rejects(core.getCredential("user-a"), /pipedrive_reconnect_required/);

  await connect(core, "user-a", "a@example.test", "acme", "second");
  const reconnected = await core.getCredential("user-a");
  assert.equal(reconnected.companyId, "company-a");
  assert.equal(reconnected.accessCredential, "access-second");
});

test("self and admin disconnect are generation-bound and affect only their selected user", async () => {
  const tenant = registry("acme", "company-a", "Tenant A");
  const first = connection(new MemoryStorage(), tenant, oauthFetcher("acme", "company-a", "Tenant A"));
  const second = connection(new MemoryStorage(), tenant, oauthFetcher("acme", "company-a", "Tenant A"));
  await connect(first, "user-a", "a@example.test", "acme", "a");
  await connect(second, "user-b", "b@example.test", "acme", "b");
  const firstCredential = await first.getCredential("user-a");

  await assert.rejects(
    first.adminDisconnect("user-a", firstCredential.generation - 1),
    /oauth_state_stale/,
  );
  assert.equal(await first.adminDisconnect("user-a", firstCredential.generation), true);
  await assert.rejects(first.getCredential("user-a"), /pipedrive_not_connected/);
  assert.equal((await second.getCredential("user-b")).companyId, "company-a");
  assert.equal(tenant.removed.length, 1);
});

test("requires one-shot user action for OAuth state and reports projection capacity safely", async () => {
  const tenant = registry("acme", "company-a", "Tenant A");
  tenant.upsertProjection = async () => { throw new Error("tenant_registry_capacity_exceeded"); };
  const core = connection(
    new MemoryStorage(),
    tenant,
    oauthFetcher("acme", "company-a", "Tenant A"),
  );
  await assert.rejects(core.createState({
    accessSub: "user-a",
    accessEmail: "a@example.test",
    expectedDomain: "acme",
    redirectUri,
    actionToken: "invalid-action-token",
  }), /user_action_invalid/);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (value?: unknown) => warnings.push(String(value));
  try {
    await connect(core, "user-a", "a@example.test", "acme", "working");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal((await core.getCredential("user-a")).companyId, "company-a");
  assert.equal(JSON.parse(warnings[0] as string).code, "tenant_registry_capacity_exceeded");
  assert.doesNotMatch(warnings.join(""), /user-a|a@example|access-working|refresh-working/);
});

class MemoryStorage implements KeyValueStorage {
  private values = new Map<string, unknown>();
  private tail: Promise<void> = Promise.resolve();

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
  async transaction<T>(closure: (transaction: KeyValueOps) => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone(this.values);
    try {
      return await closure(this);
    } catch (error) {
      this.values = snapshot;
      throw error;
    } finally {
      release();
    }
  }
}

function registry(domain: string, companyId: string, companyName: string) {
  let generation = 1;
  let active = true;
  let pinned = false;
  let suspendAfterPin = false;
  const tenantId = `tenant-${domain}`;
  const projections: AdminConnectionProjectionInput[] = [];
  const removed: string[] = [];
  const record = (): TenantRecord => ({
    domain,
    status: active ? "active" : "suspended",
    tenantId,
    generation,
    createdAtMs: 1,
    updatedAtMs: generation,
    ...(pinned ? { companyId, companyName } : {}),
  });
  const port: TenantRegistryPort & {
    suspend(): void;
    resume(): void;
    suspendAfterNextPin(): void;
    projections: AdminConnectionProjectionInput[];
    removed: string[];
  } = {
    async checkAdmission(candidate) {
      if (!active || candidate !== domain) throw new Error("tenant_admission_denied");
      return record();
    },
    async pinOrMatchCompany(candidate, candidateCompanyId, candidateCompanyName) {
      if (!active || candidate !== domain) throw new Error("tenant_admission_denied");
      if (candidateCompanyId !== companyId) throw new Error("tenant_company_mismatch");
      if (!pinned) {
        pinned = true;
        generation += 1;
      }
      if (candidateCompanyName !== companyName) throw new Error("tenant_company_mismatch");
      const result = record();
      if (suspendAfterPin) {
        suspendAfterPin = false;
        active = false;
        generation += 1;
      }
      return result;
    },
    async upsertProjection(input) { projections.push(structuredClone(input)); },
    async removeProjection(ref) { removed.push(ref); },
    suspend() { if (active) { active = false; generation += 1; } },
    resume() { if (!active) { active = true; generation += 1; } },
    suspendAfterNextPin() { suspendAfterPin = true; },
    projections,
    removed,
  };
  return port;
}

function connection(
  storage: KeyValueStorage,
  tenant: TenantRegistryPort,
  fetcher: typeof fetch,
  now: () => number = () => 1_000,
  alarms: number[] = [],
): UserConnectionCore {
  let id = 0;
  return new UserConnectionCore(storage, config(), tenant, {
    fetcher,
    now,
    randomId: () => `opaque-operation-${++id}`,
    setAlarm: async (timestamp) => { alarms.push(timestamp); },
  });
}

async function connect(
  core: UserConnectionCore,
  accessSub: string,
  accessEmail: string,
  domain: string,
  code: string,
): Promise<void> {
  const actionToken = await core.issueSelfAction(accessSub);
  const state = await core.createState({
    accessSub,
    accessEmail,
    expectedDomain: domain,
    redirectUri,
    actionToken,
  });
  await core.exchange({ accessSub, state, code, redirectUri });
}

function oauthFetcher(domain: string, companyId: string, companyName: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/oauth/token") {
      const fields = new URLSearchParams(String(init?.body));
      const code = fields.get("code") ?? "refresh";
      return Response.json({
        access_token: `access-${code}`,
        refresh_token: `refresh-${code}`,
        expires_in: 3_600,
        api_domain: `https://${domain}.pipedrive.com`,
      });
    }
    return currentUser(companyId, companyName);
  };
}

function currentUser(companyId: string, companyName: string): Response {
  return Response.json({ success: true, data: { company_id: companyId, company_name: companyName } });
}

function config(): RemoteConfig {
  return {
    accessIssuer: "https://issuer.example.test",
    accessAudience: "audience",
    adminEmail: "admin@example.test",
    pipedriveClientId: "client",
    pipedriveClientSecret: "secret",
    encryptionKey: base64Url(Uint8Array.from({ length: 32 }, (_, index) => index)),
    auditHmacKey: base64Url(Uint8Array.from({ length: 32 }, (_, index) => 255 - index)),
  };
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
