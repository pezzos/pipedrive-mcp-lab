import assert from "node:assert/strict";
import test from "node:test";

import {
  lengthPrefixedObjectKey,
  tenantRegistryObjectKey,
  userCompanyPolicyObjectKey,
  userConnectionObjectKey,
} from "../src/remote/objectKey.js";
import type { KeyValueOps, KeyValueStorage } from "../src/remote/policy.js";
import {
  normalizePipedriveSubdomain,
  TenantRegistry,
  TenantRegistryCore,
  tenantRegistryStub,
} from "../src/remote/tenantRegistry.js";

test("builds collision-safe length-prefixed Durable Object keys", () => {
  assert.notEqual(
    lengthPrefixedObjectKey("fixture", "a:b", "c"),
    lengthPrefixedObjectKey("fixture", "a", "b:c"),
  );
  assert.notEqual(
    lengthPrefixedObjectKey("fixture", "é", "x"),
    lengthPrefixedObjectKey("fixture", "e", "x"),
  );
  assert.notEqual(
    userConnectionObjectKey("user:one"),
    userCompanyPolicyObjectKey("user", "one"),
  );
  assert.match(tenantRegistryObjectKey(), /^lp1:/);
  assert.throws(() => lengthPrefixedObjectKey("fixture", ""), /object_key_invalid/);
  assert.throws(
    () => lengthPrefixedObjectKey("fixture", "x".repeat(1_025)),
    /object_key_invalid/,
  );
});

test("normalizes only one-label Pipedrive subdomains", () => {
  assert.equal(normalizePipedriveSubdomain("  Acme-42  "), "acme-42");
  for (const hostile of [
    "https://acme.pipedrive.com",
    "acme.pipedrive.com",
    "acme/path",
    "user@acme",
    "-acme",
    "acme-",
    "acme..other",
    "équipe",
    "a".repeat(64),
    "",
  ]) {
    assert.throws(() => normalizePipedriveSubdomain(hostile), /tenant_domain_invalid/);
  }
});

test("approves, suspends, resumes, and pin-or-matches safe company metadata", async () => {
  let now = 1_000;
  let tenantCounter = 0;
  const core = registryCore(new MemoryStorage(), {
    now: () => now,
    randomOpaqueId: () => `tenant-correlation-${++tenantCounter}`,
  });

  const approval = await core.issueAdminAction("admin-sub", "approve", " Acme ");
  const approved = await core.approve("admin-sub", "acme", approval);
  assert.deepEqual(approved, {
    domain: "acme",
    status: "active",
    tenantId: "tenant-correlation-1",
    generation: 1,
    createdAtMs: 1_000,
    updatedAtMs: 1_000,
  });

  now = 2_000;
  const pinned = await core.pinOrMatchCompany("ACME", "company-42", "  Acme   Société  ");
  assert.equal(pinned.companyId, "company-42");
  assert.equal(pinned.companyName, "Acme Société");
  assert.equal(pinned.generation, 2);
  assert.equal(
    (await core.pinOrMatchCompany("acme", "company-42", "Acme Société")).generation,
    2,
  );
  await assert.rejects(
    core.pinOrMatchCompany("acme", "company-other", "Acme Société"),
    /tenant_company_mismatch/,
  );
  const renamed = await core.pinOrMatchCompany("acme", "company-42", "Other name");
  assert.equal(renamed.companyName, "Other name");

  now = 3_000;
  const suspendTicket = await core.issueAdminAction("admin-sub", "suspend", "acme");
  const suspended = await core.suspend("admin-sub", "acme", suspendTicket);
  assert.equal(suspended.status, "suspended");
  assert.equal(suspended.generation, 4);
  await assert.rejects(
    core.pinOrMatchCompany("acme", "company-42", "Acme Société"),
    /tenant_admission_denied/,
  );

  now = 4_000;
  const resumeTicket = await core.issueAdminAction("admin-sub", "resume", "acme");
  const resumed = await core.resume("admin-sub", "acme", resumeTicket);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.generation, 5);
  assert.equal(resumed.createdAtMs, 1_000);
  assert.equal(resumed.updatedAtMs, 4_000);
});

test("ordinary admission has one shared lookup and bounded latency path", async () => {
  let clock = 0;
  let lookupFinished = false;
  const delays: number[] = [];
  const storage = new InstrumentedStorage(() => {
    clock += 3;
    lookupFinished = true;
  });
  const core = registryCore(storage, {
    monotonicNow: () => clock,
    admissionLatencyMs: 10,
    sleep: async (milliseconds) => {
      assert.equal(lookupFinished, true, "latency normalization must happen after lookup");
      delays.push(milliseconds);
      clock += milliseconds;
    },
  });
  await approve(core, "acme");
  await approve(core, "sleeping");
  const suspendTicket = await core.issueAdminAction("admin-sub", "suspend", "sleeping");
  await core.suspend("admin-sub", "sleeping", suspendTicket);
  storage.admissionReads = 0;

  const active = await admission("acme");
  const suspended = await admission("sleeping");
  const unknown = await admission("unknown");
  const hostile = await admission("https://acme.pipedrive.com");

  assert.equal(active.active, true);
  assert.deepEqual(suspended, { active: false, code: "tenant_admission_denied" });
  assert.deepEqual(unknown, suspended);
  assert.deepEqual(hostile, suspended);
  assert.deepEqual(delays, [7, 7, 7, 7]);
  assert.equal(storage.admissionReads, 4);

  async function admission(domain: string) {
    lookupFinished = false;
    return core.checkAdmission(domain);
  }
});

test("admin projection is bounded, token-free, and contains only approved fields", async () => {
  const storage = new MemoryStorage();
  const core = registryCore(storage);
  await approve(core, "acme");
  const row = await core.upsertConnectionProjection({
    connectionRef: "opaque-user-ref",
    accessSub: "access-sub-fixture",
    accessEmail: "user@example.test",
    domain: "acme",
    state: "connected",
    generation: 7,
    connectedAtMs: 1_000,
    lastUsedAtMs: 2_000,
    tokenExpiresAtMs: 3_000,
    accessToken: "access-token-canary",
    refreshToken: "refresh-token-canary",
    pipedriveUserEmail: "provider-user-canary@example.test",
  });
  assert.deepEqual(Object.keys(row).sort(), [
    "accessEmail",
    "connectedAtMs",
    "connectionRef",
    "domain",
    "generation",
    "lastUsedAtMs",
    "state",
    "tokenExpiresAtMs",
  ]);
  assert.equal("accessSub" in row, false);
  const projection = await core.getAdminProjection();
  assert.equal(projection.tenants[0]?.connectedUserCount, 1);
  assert.deepEqual(projection.connections, [row]);
  assert.doesNotMatch(JSON.stringify(projection), /(?:access|refresh)-token-canary|provider-user-canary/);

  await storage.put(
    "connection-index:v1",
    Array.from({ length: 500 }, (_, index) => `occupied-${index}`),
  );
  await assert.rejects(
    core.upsertConnectionProjection({
      connectionRef: "one-too-many",
      accessSub: "other-access-sub",
      accessEmail: "other@example.test",
      domain: "acme",
      state: "connected",
      generation: 1,
      connectedAtMs: 1,
    }),
    /tenant_registry_capacity_exceeded/,
  );
});

test("admin action tickets are one-shot and bound to actor, action, target, generation and expiry", async () => {
  let now = 10_000;
  const storage = new MemoryStorage();
  const core = registryCore(storage, { now: () => now });
  const wrongActor = await core.issueAdminAction("admin-sub", "approve", "acme");
  await assert.rejects(core.approve("other-sub", "acme", wrongActor), /tenant_admin_action_invalid/);
  await assert.rejects(core.approve("admin-sub", "acme", wrongActor), /tenant_admin_action_invalid/);

  await approve(core, "acme");
  const wrongAction = await core.issueAdminAction("admin-sub", "suspend", "acme");
  await assert.rejects(core.resume("admin-sub", "acme", wrongAction), /tenant_admin_action_invalid/);
  assert.equal((await core.suspend("admin-sub", "acme", wrongAction)).status, "suspended");
  const restore = await core.issueAdminAction("admin-sub", "resume", "acme");
  assert.equal((await core.resume("admin-sub", "acme", restore)).status, "active");

  const stale = await core.issueAdminAction("admin-sub", "suspend", "acme");
  await core.pinOrMatchCompany("acme", "company-1", "Company One");
  await assert.rejects(core.suspend("admin-sub", "acme", stale), /tenant_admin_action_invalid/);

  const expired = await core.issueAdminAction("admin-sub", "suspend", "acme");
  now += 10 * 60_000;
  await assert.rejects(core.suspend("admin-sub", "acme", expired), /tenant_admin_action_invalid/);

  await core.upsertConnectionProjection({
    connectionRef: "opaque-user-ref",
    accessSub: "access-sub-fixture",
    accessEmail: "user@example.test",
    domain: "acme",
    state: "connected",
    generation: 2,
    connectedAtMs: 1,
  });
  const displayTicket = await core.issueAdminActionTicket(
    "admin-sub", "force-disconnect", "opaque-user-ref",
  );
  assert.deepEqual(Object.keys(displayTicket.forceDisconnectTarget ?? {}).sort(), [
    "accessEmail", "connectedAtMs", "connectionRef", "domain", "generation", "state",
  ]);
  assert.equal(displayTicket.forceDisconnectTarget?.connectionRef, "opaque-user-ref");
  assert.doesNotMatch(JSON.stringify(displayTicket.forceDisconnectTarget), /accessSub|tenantId|token|secret|oauth|crm|pipedrive/i);
  const forceTicket = await core.issueAdminAction(
    "admin-sub",
    "force-disconnect",
    "opaque-user-ref",
  );
  await core.upsertConnectionProjection({
    connectionRef: "opaque-user-ref",
    accessSub: "access-sub-fixture",
    accessEmail: "user@example.test",
    domain: "acme",
    state: "connected",
    generation: 3,
    connectedAtMs: 1,
  });
  await assert.rejects(
    core.consumeForceDisconnectAction("admin-sub", "opaque-user-ref", forceTicket),
    /tenant_admin_action_invalid/,
  );
  await assert.rejects(
    core.consumeForceDisconnectAction("admin-sub", "opaque-user-ref", forceTicket),
    /tenant_admin_action_invalid/,
  );

  const validForceTicket = await core.issueAdminAction(
    "admin-sub",
    "force-disconnect",
    "opaque-user-ref",
  );
  assert.equal(
    (await core.consumeForceDisconnectAction(
      "admin-sub",
      "opaque-user-ref",
      validForceTicket,
    )).accessSub,
    "access-sub-fixture",
  );
  await assert.rejects(
    core.consumeForceDisconnectAction("admin-sub", "opaque-user-ref", validForceTicket),
    /tenant_admin_action_invalid/,
  );

  const suspendTicket = await core.issueAdminAction("admin-sub", "suspend", "acme");
  const secondForceTicket = await core.issueAdminAction(
    "admin-sub",
    "force-disconnect",
    "opaque-user-ref",
  );
  assert.equal((await core.suspend("admin-sub", "acme", suspendTicket)).status, "suspended");
  assert.equal(
    (await core.consumeForceDisconnectAction(
      "admin-sub",
      "opaque-user-ref",
      secondForceTicket,
    )).generation,
    3,
  );
});

test("fails closed with stable HTTP errors when requests or storage are unavailable", async () => {
  let normalized = false;
  const failingCore = registryCore(new FailingStorage(), {
    admissionLatencyMs: 5,
    sleep: async () => {
      normalized = true;
    },
  });
  await assert.rejects(failingCore.checkAdmission("acme"), /tenant_registry_unavailable/);
  assert.equal(normalized, true);

  const malformedRegistry = new TenantRegistry(durableObjectState(new MemoryStorage()));
  const malformed = await malformedRegistry.fetch(new Request("https://registry/admission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "request-secret-canary",
  }));
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { code: "tenant_registry_request_invalid" });

  const unavailableRegistry = new TenantRegistry(durableObjectState(new FailingStorage()));
  const unavailable = await unavailableRegistry.fetch(new Request("https://registry/admission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: "acme" }),
  }));
  assert.equal(unavailable.status, 503);
  const unavailableBody = await unavailable.text();
  assert.deepEqual(JSON.parse(unavailableBody), { code: "tenant_registry_unavailable" });
  assert.doesNotMatch(unavailableBody, /storage-secret-canary/);
});

test("registry stub always uses the fixed global namespaced key", () => {
  const names: string[] = [];
  const stub = {} as DurableObjectStub;
  const namespace = {
    idFromName(name: string) {
      names.push(name);
      return name as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      assert.equal(id as unknown as string, tenantRegistryObjectKey());
      return stub;
    },
  } as unknown as DurableObjectNamespace;
  assert.equal(tenantRegistryStub({ TENANT_REGISTRY: namespace }), stub);
  assert.deepEqual(names, [tenantRegistryObjectKey()]);
});

class MemoryStorage implements KeyValueStorage {
  protected readonly values = new Map<string, unknown>();
  private transactionTail: Promise<void> = Promise.resolve();

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
    const previous = this.transactionTail;
    const release = deferred<void>();
    this.transactionTail = release.promise;
    await previous;
    const snapshot = structuredClone(this.values);
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
}

class InstrumentedStorage extends MemoryStorage {
  admissionReads = 0;

  constructor(private readonly afterRead: () => void) {
    super();
  }

  override async get<T>(key: string): Promise<T | undefined> {
    if (key.startsWith("lp1:2:13:tenant-record")) {
      this.admissionReads += 1;
      this.afterRead();
    }
    return super.get<T>(key);
  }
}

class FailingStorage extends MemoryStorage {
  override async get<T>(_key: string): Promise<T | undefined> {
    throw new Error("storage-secret-canary");
  }

  override async transaction<T>(
    _closure: (transaction: KeyValueOps) => Promise<T>,
  ): Promise<T> {
    throw new Error("storage-secret-canary");
  }
}

function registryCore(
  storage: KeyValueStorage,
  options: ConstructorParameters<typeof TenantRegistryCore>[1] = {},
): TenantRegistryCore {
  let tokenCounter = 0;
  return new TenantRegistryCore(storage, {
    admissionLatencyMs: 0,
    sleep: async () => {},
    randomOpaqueId: () => "tenant-correlation-opaque",
    randomActionToken: () => `${String(++tokenCounter).padStart(4, "0")}${"x".repeat(40)}`,
    ...options,
  });
}

async function approve(core: TenantRegistryCore, domain: string): Promise<void> {
  const ticket = await core.issueAdminAction("admin-sub", "approve", domain);
  await core.approve("admin-sub", domain, ticket);
}

function durableObjectState(storage: KeyValueStorage): DurableObjectState {
  return { storage } as unknown as DurableObjectState;
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
