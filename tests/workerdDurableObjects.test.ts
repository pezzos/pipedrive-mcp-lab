import assert from "node:assert/strict";
import test from "node:test";

import { Miniflare } from "miniflare";

import {
  tenantRegistryObjectKey,
  userCompanyPolicyObjectKey,
  userConnectionObjectKey,
} from "../src/remote/objectKey.js";

test("workerd routes the v2 registry, per-user connection, and composite policy objects", async () => {
  const mf = new Miniflare({
    scriptPath: "dist/worker/worker.js",
    modules: true,
    compatibilityDate: "2026-07-15",
    durableObjects: {
      TENANT_REGISTRY: { className: "TenantRegistry", useSQLite: true },
      USER_CONNECTION: { className: "UserConnection", useSQLite: true },
      USER_POLICY: { className: "UserPolicy", useSQLite: true },
    },
    bindings: {
      PIPEDRIVE_OAUTH_CLIENT_ID: "fixture-client",
      PIPEDRIVE_OAUTH_CLIENT_SECRET: "fixture-secret",
      PIPEDRIVE_OAUTH_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      AUDIT_HMAC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
  });
  try {
    const registry = await mf.getDurableObjectNamespace("TENANT_REGISTRY");
    const registryStub = registry.get(registry.idFromName(tenantRegistryObjectKey()));
    const ticket = await registryStub.fetch("https://registry.internal/admin/action-ticket", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminSub: "admin-sub", action: "approve", target: "acme" }),
    });
    assert.equal(ticket.status, 200);
    const { actionToken } = await ticket.json() as { actionToken: string };
    const approval = await registryStub.fetch("https://registry.internal/admin/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminSub: "admin-sub", domain: "acme", actionToken }),
    });
    assert.equal(approval.status, 200);
    assert.equal(((await approval.json()) as any).status, "active");

    const connections = await mf.getDurableObjectNamespace("USER_CONNECTION");
    const first = connections.get(connections.idFromName(userConnectionObjectKey("user-a")));
    const second = connections.get(connections.idFromName(userConnectionObjectKey("user-b")));
    const [firstStatus, secondStatus] = await Promise.all([
      first.fetch("https://connection.internal/status"),
      second.fetch("https://connection.internal/status"),
    ]);
    assert.deepEqual(await firstStatus.json(), {
      connected: false,
      reconnectRequired: false,
      generation: 0,
    });
    assert.deepEqual(await secondStatus.json(), {
      connected: false,
      reconnectRequired: false,
      generation: 0,
    });
    assert.notEqual(userConnectionObjectKey("user-a"), userConnectionObjectKey("user-b"));

    const policies = await mf.getDurableObjectNamespace("USER_POLICY");
    const policyA = policies.get(
      policies.idFromName(userCompanyPolicyObjectKey("user-a", "company-a")),
    );
    const policyB = policies.get(
      policies.idFromName(userCompanyPolicyObjectKey("user-a", "company-b")),
    );
    assert.deepEqual(await (await policyA.fetch("https://policy.internal/policy")).json(), {
      writes: false,
      deletes: false,
      mailbox: false,
      revision: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
    assert.notEqual(
      userCompanyPolicyObjectKey("user-a", "company-a"),
      userCompanyPolicyObjectKey("user-a", "company-b"),
    );
    assert.equal((await policyB.fetch("https://policy.internal/policy")).status, 200);
  } finally {
    await mf.dispose();
  }
});
