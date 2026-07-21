import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { clearAccessJwksCache } from "../src/remote/access.js";
import type { RemoteEnv } from "../src/remote/env.js";
import {
  tenantRegistryObjectKey,
  userCompanyPolicyObjectKey,
  userConnectionObjectKey,
} from "../src/remote/objectKey.js";
import worker from "../src/remote/worker.js";

const issuer = "https://team.cloudflareaccess.com";
const audience = "worker-audience";

test("Worker exposes health before Access and audits a missing assertion", async () => {
  const health = await worker.fetch(
    new Request("https://mcp.example.test/healthz"),
    remoteEnv(failingNamespace(), failingNamespace(), failingNamespace()),
    executionContext().value,
  );
  assert.equal(health.status, 200);

  const context = executionContext();
  const { value: denied, logs } = await captureLogs(async () => {
    const response = await worker.fetch(
      new Request("https://mcp.example.test/pipedrive"),
      remoteEnv(failingNamespace(), failingNamespace(), failingNamespace()),
      context.value,
    );
    await Promise.all(context.waits);
    return response;
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { code: "access_token_missing" });
  assert.equal(JSON.parse(logs[0] as string).actorId, "anonymous");
});

test("any Access user can view only their own connection and start exact-origin OAuth", async () => {
  const fixture = await accessFixture("user@example.test", "user-one");
  const names: string[] = [];
  const calls: string[] = [];
  const connectionNamespace = namespaceFor(async (request) => {
    const path = new URL(request.url).pathname;
    calls.push(path);
    if (path === "/status") {
      return Response.json({ connected: false, reconnectRequired: false, generation: 0 });
    }
    if (path === "/self-action") return Response.json({ actionToken: "self-action-token" });
    if (path === "/state") {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.accessSub, "user-one");
      assert.equal(body.accessEmail, "user@example.test");
      assert.equal(body.expectedDomain, "acme");
      assert.equal(body.actionToken, "self-action-token");
      return Response.json({ state: "oauth-state" });
    }
    throw new Error(`unexpected_connection_path:${path}`);
  }, names);

  await withJwks(fixture.jwk, async () => {
    const page = await worker.fetch(
      authorizedRequest("https://mcp.example.test/pipedrive", fixture.assertion),
      remoteEnv(failingNamespace(), connectionNamespace, failingNamespace()),
      executionContext().value,
    );
    assert.equal(page.status, 200);
    assertPageEnvelope(page);
    assert.match(await page.text(), /Ma connexion Pipedrive/);

    const connect = await worker.fetch(
      authorizedForm("https://mcp.example.test/pipedrive/connect", fixture.assertion, {
        domain: "Acme",
        confirm: "yes",
        csrf: "self-action-token",
      }),
      remoteEnv(failingNamespace(), connectionNamespace, failingNamespace()),
      executionContext().value,
    );
    assert.equal(connect.status, 302);
    assert.equal(connect.headers.get("cache-control"), "no-store");
    assert.equal(new URL(connect.headers.get("location") as string).searchParams.get("state"), "oauth-state");

    const badOrigin = await worker.fetch(
      authorizedForm("https://mcp.example.test/pipedrive/connect", fixture.assertion, {
        domain: "acme",
        confirm: "yes",
        csrf: "self-action-token",
      }, "https://evil.example.test"),
      remoteEnv(failingNamespace(), connectionNamespace, failingNamespace()),
      executionContext().value,
    );
    assert.equal(badOrigin.status, 403);
  });
  assert.ok(calls.includes("/state"));
  assert.deepEqual(new Set(names), new Set([userConnectionObjectKey("user-one")]));
});

test("OAuth callback is bound to the Access user and never requires admin identity", async () => {
  const fixture = await accessFixture("user@example.test", "user-one");
  const connectionNamespace = namespaceFor(async (request) => {
    assert.equal(new URL(request.url).pathname, "/exchange");
    const body = await request.json() as Record<string, unknown>;
    assert.equal(body.accessSub, "user-one");
    assert.equal(body.state, "state-fixture");
    assert.equal(body.code, "code-fixture");
    return Response.json({ connected: true });
  });
  await withJwks(fixture.jwk, async () => {
    const response = await worker.fetch(
      authorizedRequest(
        "https://mcp.example.test/oauth/pipedrive/callback?state=state-fixture&code=code-fixture",
        fixture.assertion,
      ),
      remoteEnv(failingNamespace(), connectionNamespace, failingNamespace()),
      executionContext().value,
    );
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("location") as string).pathname, "/pipedrive");
  });
});

test("admin allowlist is global and token-free while non-admins fail before registry access", async () => {
  const user = await accessFixture("user@example.test", "user-one");
  let registryCalls = 0;
  const registryNamespace = namespaceFor(async (request) => {
    registryCalls += 1;
    const path = new URL(request.url).pathname;
    if (path === "/admin/projection") {
      return Response.json({
        tenants: [{
          domain: "acme", status: "active", tenantId: "tenant-opaque", generation: 1,
          createdAtMs: 1, updatedAtMs: 1, connectedUserCount: 0,
        }],
        connections: [],
      });
    }
    if (path === "/admin/action-ticket") return Response.json({ actionToken: "admin-action-token" });
    throw new Error(`unexpected_registry_path:${path}`);
  });
  await withJwks(user.jwk, async () => {
    const context = executionContext();
    const { value: denied, logs } = await captureLogs(async () => {
      const response = await worker.fetch(
        authorizedRequest("https://mcp.example.test/admin/pipedrive", user.assertion),
        remoteEnv(failingNamespace(), failingNamespace(), registryNamespace),
        context.value,
      );
      await Promise.all(context.waits);
      return response;
    });
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(logs[0] as string).errorCode, "admin_required");
  });
  assert.equal(registryCalls, 0);

  const admin = await accessFixture("admin@example.com", "admin-sub");
  await withJwks(admin.jwk, async () => {
    const response = await worker.fetch(
      authorizedRequest("https://mcp.example.test/admin/pipedrive", admin.assertion),
      remoteEnv(failingNamespace(), failingNamespace(), registryNamespace),
      executionContext().value,
    );
    assert.equal(response.status, 200);
    assertPageEnvelope(response);
    const page = await response.text();
    assert.match(page, /acme\.pipedrive\.com/);
    assert.doesNotMatch(page, /tenant-opaque|access_token|refresh_token/);
  });
  assert.equal(registryCalls, 1, "page load must not pre-issue one ticket per row");

  await withJwks(admin.jwk, async () => {
    const response = await worker.fetch(
      authorizedForm(
        "https://mcp.example.test/admin/pipedrive/action/confirm",
        admin.assertion,
        { action: "suspend", domain: "acme" },
      ),
      remoteEnv(failingNamespace(), failingNamespace(), registryNamespace),
      executionContext().value,
    );
    assert.equal(response.status, 200);
    assertPageEnvelope(response);
    assert.match(await response.text(), /admin-action-token/);
  });
  assert.equal(registryCalls, 2);
});

test("admin approval, tenant mutation, and force-disconnect enforce confirmation and audit", async () => {
  const admin = await accessFixture("admin@example.com", "admin-sub");
  const registryPaths: string[] = [];
  const registry = namespaceFor(async (request) => {
    const path = new URL(request.url).pathname;
    registryPaths.push(path);
    if (path === "/admin/action-ticket") {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.adminSub, "admin-sub");
      return Response.json({ actionToken: `ticket-${String(body.action)}` });
    }
    if (path === "/admin/suspend") {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.domain, "acme");
      assert.equal(body.actionToken, "ticket-suspend");
      return Response.json({ tenantId: "tenant-opaque", status: "suspended" });
    }
    if (path === "/admin/force-disconnect/consume") {
      return Response.json({
        accessSub: "selected-user",
        generation: 9,
        tenantId: "tenant-opaque",
      });
    }
    throw new Error(`unexpected_registry_path:${path}`);
  });
  const connectionNames: string[] = [];
  const connections = namespaceFor(async (request) => {
    assert.equal(new URL(request.url).pathname, "/admin-disconnect");
    const body = await request.json() as Record<string, unknown>;
    assert.equal(body.accessSub, "selected-user");
    assert.equal(body.expectedGeneration, 9);
    return Response.json({ disconnected: true });
  }, connectionNames);

  await withJwks(admin.jwk, async () => {
    const approval = await worker.fetch(
      authorizedForm(
        "https://mcp.example.test/admin/pipedrive/approve/confirm",
        admin.assertion,
        { domain: "acme" },
      ),
      remoteEnv(failingNamespace(), connections, registry),
      executionContext().value,
    );
    assert.equal(approval.status, 200);
    assertPageEnvelope(approval);
    assert.match(await approval.text(), /ticket-approve/);

    const missingConfirmation = await worker.fetch(
      authorizedForm(
        "https://mcp.example.test/admin/pipedrive/tenant",
        admin.assertion,
        { action: "suspend", domain: "acme", csrf: "ticket-suspend" },
      ),
      remoteEnv(failingNamespace(), connections, registry),
      executionContext().value,
    );
    assert.equal(missingConfirmation.status, 400);

    const badOrigin = await worker.fetch(
      authorizedForm(
        "https://mcp.example.test/admin/pipedrive/force-disconnect",
        admin.assertion,
        { connection_ref: "selected-ref", csrf: "ticket-force", confirm: "yes" },
        "https://evil.example.test",
      ),
      remoteEnv(failingNamespace(), connections, registry),
      executionContext().value,
    );
    assert.equal(badOrigin.status, 403);

    const tenantContext = executionContext();
    const tenantResult = await captureLogs(async () => {
      const response = await worker.fetch(
        authorizedForm(
          "https://mcp.example.test/admin/pipedrive/tenant",
          admin.assertion,
          {
            action: "suspend",
            domain: "acme",
            csrf: "ticket-suspend",
            confirm: "yes",
          },
        ),
        remoteEnv(failingNamespace(), connections, registry),
        tenantContext.value,
      );
      await Promise.all(tenantContext.waits);
      return response;
    });
    assert.equal(tenantResult.value.status, 303);
    assert.equal(tenantResult.value.headers.get("cache-control"), "no-store");
    assert.equal(JSON.parse(tenantResult.logs[0] as string).tenantId, "tenant-opaque");

    const forceContext = executionContext();
    const forceResult = await captureLogs(async () => {
      const response = await worker.fetch(
        authorizedForm(
          "https://mcp.example.test/admin/pipedrive/force-disconnect",
          admin.assertion,
          { connection_ref: "selected-ref", csrf: "ticket-force", confirm: "yes" },
        ),
        remoteEnv(failingNamespace(), connections, registry),
        forceContext.value,
      );
      await Promise.all(forceContext.waits);
      return response;
    });
    assert.equal(forceResult.value.status, 303);
    assert.equal(forceResult.value.headers.get("cache-control"), "no-store");
    assert.equal(JSON.parse(forceResult.logs[0] as string).tenantId, "tenant-opaque");
  });

  assert.ok(registryPaths.includes("/admin/action-ticket"));
  assert.ok(registryPaths.includes("/admin/suspend"));
  assert.ok(registryPaths.includes("/admin/force-disconnect/consume"));
  assert.deepEqual(connectionNames, [userConnectionObjectKey("selected-user")]);
});

test("force confirmation renders only the registry ticket target, never browser display fields", async () => {
  const admin = await accessFixture("admin@example.com", "admin-sub");
  const registry = namespaceFor(async (request) => {
    assert.equal(new URL(request.url).pathname, "/admin/action-ticket");
    const body = await request.json() as Record<string, unknown>;
    assert.equal(body.action, "force-disconnect");
    assert.equal(body.target, "opaque-selected-ref");
    return Response.json({ actionToken: "ticket-fixture", forceDisconnectTarget: {
      connectionRef: "opaque-selected-ref", accessEmail: "selected@example.invalid", domain: "selected", state: "connected", generation: 7, connectedAtMs: 0,
    } });
  });
  await withJwks(admin.jwk, async () => {
    const response = await worker.fetch(authorizedForm(
      "https://mcp.example.test/admin/pipedrive/action/confirm", admin.assertion,
      { action: "force-disconnect", connection_ref: "opaque-selected-ref", access_email: "hostile@example.invalid", domain: "hostile", tenantId: "hostile-tenant" },
    ), remoteEnv(failingNamespace(), failingNamespace(), registry), executionContext().value);
    assert.equal(response.status, 200);
    assertPageEnvelope(response);
    const html = await response.text();
    assert.match(html, /selected@example\.invalid/);
    assert.match(html, /selected\.pipedrive\.com/);
    assert.match(html, /Connectée/);
    assert.doesNotMatch(html, /hostile@example|hostile-tenant|accessSub|tenantId|access_token|refresh_token/i);
  });
});

test("settings policy is physically keyed by Access subject and verified company id", async () => {
  const fixture = await accessFixture("user@example.test", "user:one");
  const connectionNames: string[] = [];
  const policyNames: string[] = [];
  const connectionNamespace = namespaceFor(async () => Response.json(credential()), connectionNames);
  const policyNamespace = namespaceFor(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/policy") return Response.json(readOnlyPolicy());
    if (path === "/csrf") return Response.json({ csrf: "x".repeat(43) });
    throw new Error(`unexpected_policy_path:${path}`);
  }, policyNames);
  await withJwks(fixture.jwk, async () => {
    const response = await worker.fetch(
      authorizedRequest("https://mcp.example.test/settings", fixture.assertion),
      remoteEnv(policyNamespace, connectionNamespace, failingNamespace()),
      executionContext().value,
    );
    assert.equal(response.status, 200);
    assertPageEnvelope(response);
  });
  assert.deepEqual(connectionNames, [userConnectionObjectKey("user:one")]);
  assert.deepEqual(policyNames, [userCompanyPolicyObjectKey("user:one", "company:42")]);
});

test("same-origin browser UI failures recover through typed no-store routes while malformed settings CSRF never renders", async () => {
  const user = await accessFixture("user@example.test", "user-one");
  const admin = await accessFixture("admin@example.com", "admin-sub");
  const rejected = namespaceFor(async () => { throw new Error("durable_object_rejected"); });
  const credentialNamespace = namespaceFor(async (request) => {
    assert.equal(new URL(request.url).pathname, "/credential");
    return Response.json(credential());
  });
  const malformedCsrfPolicy = namespaceFor(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/policy") return Response.json(readOnlyPolicy());
    if (path === "/csrf") return new Response("{", { headers: { "content-type": "application/json" } });
    throw new Error(`unexpected_policy_path:${path}`);
  });
  const expectRecovery = async (response: Response, pathname: string, query: string) => {
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.pathname, pathname);
    assert.equal(location.search, query);
  };

  await withJwks(user.jwk, async () => {
    await expectRecovery(await worker.fetch(authorizedForm(
      "https://mcp.example.test/pipedrive/connect", user.assertion,
      { domain: "acme", confirm: "yes", csrf: "ticket" },
    ), remoteEnv(rejected, rejected, rejected), executionContext().value), "/pipedrive", "?notice=storage");
    await expectRecovery(await worker.fetch(authorizedRequest(
      "https://mcp.example.test/oauth/pipedrive/callback?state=s&code=c", user.assertion,
    ), remoteEnv(rejected, rejected, rejected), executionContext().value), "/pipedrive", "?notice=oauth-error");
    await expectRecovery(await worker.fetch(authorizedForm(
      "https://mcp.example.test/pipedrive/disconnect", user.assertion,
      { confirm: "yes", csrf: "ticket" },
    ), remoteEnv(rejected, rejected, rejected), executionContext().value), "/pipedrive", "?notice=storage");
    await expectRecovery(await worker.fetch(authorizedRequest(
      "https://mcp.example.test/settings", user.assertion,
    ), remoteEnv(rejected, credentialNamespace, rejected), executionContext().value), "/pipedrive", "?notice=storage");
    await expectRecovery(await worker.fetch(authorizedForm(
      "https://mcp.example.test/settings", user.assertion,
      { writes: "yes", revision: "0" },
    ), remoteEnv(malformedCsrfPolicy, credentialNamespace, rejected), executionContext().value), "/settings", "?error=policy");
  });

  await withJwks(admin.jwk, async () => {
    const adminRecovery = await worker.fetch(authorizedRequest(
      "https://mcp.example.test/admin/pipedrive", admin.assertion,
    ), remoteEnv(rejected, rejected, rejected), executionContext().value);
    assert.equal(adminRecovery.status, 503);
    assertPageEnvelope(adminRecovery);
    assert.match(await adminRecovery.text(), /registre sécurisé est momentanément indisponible/i);
    await expectRecovery(await worker.fetch(authorizedForm(
      "https://mcp.example.test/admin/pipedrive/approve/confirm", admin.assertion, { domain: "acme" },
    ), remoteEnv(rejected, rejected, rejected), executionContext().value), "/admin/pipedrive", "?error=ticket");
    await expectRecovery(await worker.fetch(authorizedForm(
      "https://mcp.example.test/admin/pipedrive/action/confirm", admin.assertion, { action: "suspend", domain: "acme" },
    ), remoteEnv(rejected, rejected, rejected), executionContext().value), "/admin/pipedrive", "?error=ticket");
  });
});

test("MCP completes discovery before Pipedrive OAuth while every tool call stays fail-closed", async () => {
  const fixture = await accessFixture("user@example.test", "user-one");
  let policyCalls = 0;
  const policyNamespace = namespaceFor(async () => {
    policyCalls += 1;
    return Response.json(readOnlyPolicy());
  });
  const missingConnection = namespaceFor(async () =>
    Response.json({ code: "pipedrive_not_connected" }, { status: 404 }));

  const { logs } = await captureLogs(async () => {
    await withJwks(fixture.jwk, async () => {
      const env = remoteEnv(policyNamespace, missingConnection, failingNamespace());
      const context = executionContext();

      const initialize = await worker.fetch(
        mcpRequest(fixture.assertion, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "claude-fixture", version: "1.0.0" },
          },
        }),
        env,
        context.value,
      );
      assert.equal(initialize.status, 200);
      assert.equal(((await initialize.json()) as any).result.serverInfo.name, "pipedrive-mcp");

      const initialized = await worker.fetch(
        mcpRequest(fixture.assertion, {
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        env,
        context.value,
      );
      assert.equal(initialized.status, 202);

      const listed = await worker.fetch(
        mcpRequest(fixture.assertion, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
        env,
        context.value,
      );
      assert.equal(listed.status, 200);
      const toolNames = ((await listed.json()) as any).result.tools.map(
        (tool: { name: string }) => tool.name,
      );
      assert.ok(toolNames.includes("pipedrive_connection_check"));
      assert.ok(toolNames.includes("pipedrive_list_deals"));
      assert.equal(toolNames.includes("pipedrive_create_deal"), false);

      const called = await worker.fetch(
        mcpRequest(fixture.assertion),
        env,
        context.value,
      );
      assert.equal(called.status, 503);
      assert.equal(((await called.json()) as any).error.data.code, "pipedrive_not_connected");
      await Promise.all(context.waits);
    });
  });

  assert.equal(policyCalls, 0);
  assert.ok(logs.some((entry) =>
    JSON.parse(entry).errorCode === "pipedrive_not_connected"
  ));
});

test("MCP discovery remains available when the user must reconnect Pipedrive", async () => {
  const fixture = await accessFixture("user@example.test", "user-one");
  const reconnectRequired = namespaceFor(async () =>
    Response.json({ code: "pipedrive_reconnect_required" }, { status: 409 }));

  const { logs } = await captureLogs(async () => {
    await withJwks(fixture.jwk, async () => {
      const context = executionContext();
      const response = await worker.fetch(
        mcpRequest(fixture.assertion, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "claude-fixture", version: "1.0.0" },
          },
        }),
        remoteEnv(failingNamespace(), reconnectRequired, failingNamespace()),
        context.value,
      );
      assert.equal(response.status, 200);
      await Promise.all(context.waits);
    });
  });
  assert.equal(JSON.parse(logs[0] as string).errorCode, "pipedrive_reconnect_required");
});

test("MCP fails closed before policy on missing connection and after provider on suspension", async () => {
  const fixture = await accessFixture("user@example.test", "user-one");
  let policyCalls = 0;
  const policyNamespace = namespaceFor(async () => {
    policyCalls += 1;
    return Response.json(readOnlyPolicy());
  });
  const missingConnection = namespaceFor(async () =>
    Response.json({ code: "pipedrive_not_connected" }, { status: 404 }));
  await withJwks(fixture.jwk, async () => {
    const context = executionContext();
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        mcpRequest(fixture.assertion),
        remoteEnv(policyNamespace, missingConnection, failingNamespace()),
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as any).error.data.code, "pipedrive_not_connected");
    assert.equal(JSON.parse(logs[0] as string).errorCode, "pipedrive_not_connected");
  });
  assert.equal(policyCalls, 0);

  const deniedConnection = namespaceFor(async () =>
    Response.json({ code: "tenant_admission_denied" }, { status: 403 }));
  await withJwks(fixture.jwk, async () => {
    const context = executionContext();
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        mcpRequest(fixture.assertion, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "claude-fixture", version: "1.0.0" },
          },
        }),
        remoteEnv(failingNamespace(), deniedConnection, failingNamespace()),
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as any).error.data.code, "tenant_admission_denied");
    assert.equal(JSON.parse(logs[0] as string).errorCode, "tenant_admission_denied");
  });

  let usedCalls = 0;
  const connection = namespaceFor(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/credential") return Response.json(credential());
    if (path === "/used") {
      usedCalls += 1;
      return Response.json({ code: "tenant_admission_denied" }, { status: 403 });
    }
    throw new Error(`unexpected_connection_path:${path}`);
  });
  await withJwks(fixture.jwk, async () => {
    const env = remoteEnv(namespaceFor(async () => Response.json(writePolicy())), connection, failingNamespace());
    const initialize = await worker.fetch(
      mcpRequest(fixture.assertion, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "claude-fixture", version: "1.0.0" },
        },
      }),
      env,
      executionContext().value,
    );
    assert.equal(initialize.status, 200);
    assert.equal(usedCalls, 0, "protocol discovery must not mark provider use");

    const context = executionContext();
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        mcpRequest(fixture.assertion),
        env,
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as any).error.data.code, "tenant_admission_denied");
    const event = JSON.parse(logs[0] as string);
    assert.equal(event.outcome, "error");
    assert.equal(event.errorCode, "tenant_admission_denied");
  });
  assert.equal(usedCalls, 1);
});

test("successful MCP audit carries pseudonymous actor and tenant correlation but no PII", async () => {
  const fixture = await accessFixture("user@example.test", "user-one");
  const connection = namespaceFor(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/credential") return Response.json(credential());
    if (path === "/used") return new Response(null, { status: 204 });
    throw new Error(`unexpected_connection_path:${path}`);
  });
  const context = executionContext();
  await withJwks(fixture.jwk, async () => {
    const { value: response, logs } = await captureLogs(async () => {
      const result = await worker.fetch(
        mcpRequest(fixture.assertion),
        remoteEnv(namespaceFor(async () => Response.json(writePolicy())), connection, failingNamespace()),
        context.value,
      );
      await Promise.all(context.waits);
      return result;
    });
    assert.equal(response.status, 200);
    const event = JSON.parse(logs[0] as string) as Record<string, unknown>;
    assert.equal(event.tenantId, "tenant-opaque");
    assert.equal(event.operation, "pipedrive_create_deal");
    assert.equal(event.outcome, "success");
    assert.doesNotMatch(JSON.stringify(event), /user@example|user-one|oauth-access/);
  });
});

test("Worker uses only the declared multi-tenant namespaces", () => {
  const source = JSON.stringify(remoteEnv(
    failingNamespace(),
    failingNamespace(),
    failingNamespace(),
  ));
  assert.doesNotMatch(source, /TENANT_SECRETS/);
  const registryNames: string[] = [];
  namespaceFor(async () => Response.json({}), registryNames).idFromName(tenantRegistryObjectKey());
  assert.deepEqual(registryNames, [tenantRegistryObjectKey()]);

  const wrangler = readFileSync("wrangler.jsonc", "utf8");
  const workerSource = readFileSync("src/remote/worker.ts", "utf8");
  const policySource = readFileSync("src/remote/policy.ts", "utf8");
  assert.match(wrangler, /"tag": "v1"[\s\S]*"tag": "v2"/);
  assert.match(wrangler, /"USER_CONNECTION"[\s\S]*"TENANT_REGISTRY"/);
  assert.doesNotMatch(wrangler, /"name": "TENANT_SECRETS"/);
  assert.doesNotMatch(workerSource, /TENANT_SECRETS|tenantSecretsStub|idFromName\("tenant"\)/);
  assert.doesNotMatch(policySource, /idFromName\(sub\)|idFromName\([^,]*sub[^,]*\)/);
});

function credential() {
  return {
    accessCredential: "oauth-access-fixture",
    apiDomain: "https://acme.pipedrive.com",
    expiresAtMs: Date.now() + 60_000,
    domain: "acme",
    companyId: "company:42",
    companyName: "Acme",
    tenantId: "tenant-opaque",
    generation: 7,
  };
}

function readOnlyPolicy() {
  return { writes: false, deletes: false, mailbox: false, revision: 0, updatedAt: "1970-01-01T00:00:00.000Z" };
}

function writePolicy() {
  return { ...readOnlyPolicy(), writes: true, revision: 1 };
}

function remoteEnv(
  policy: DurableObjectNamespace,
  connection: DurableObjectNamespace,
  registry: DurableObjectNamespace,
): RemoteEnv {
  return {
    ACCESS_ISSUER: issuer,
    ACCESS_AUD: audience,
    REMOTE_ADMIN_EMAIL: "admin@example.com",
    PIPEDRIVE_OAUTH_CLIENT_ID: "client-fixture",
    PIPEDRIVE_OAUTH_CLIENT_SECRET: "credential-fixture",
    PIPEDRIVE_OAUTH_ENCRYPTION_KEY: base64Url(Uint8Array.from({ length: 32 }, (_, i) => i)),
    AUDIT_HMAC_KEY: base64Url(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)),
    USER_POLICY: policy,
    USER_CONNECTION: connection,
    TENANT_REGISTRY: registry,
  };
}

function namespaceFor(
  handler: (request: Request) => Promise<Response>,
  names: string[] = [],
): DurableObjectNamespace {
  return {
    idFromName(name: string) { names.push(name); return name as unknown as DurableObjectId; },
    get() {
      return { fetch: (input: RequestInfo | URL, init?: RequestInit) => handler(new Request(input, init)) };
    },
  } as unknown as DurableObjectNamespace;
}

function failingNamespace(): DurableObjectNamespace {
  return namespaceFor(async () => { throw new Error("namespace_should_not_be_called"); });
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

function authorizedRequest(url: string, assertion: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cf-access-jwt-assertion", assertion);
  return new Request(url, { ...init, headers });
}

function authorizedForm(
  url: string,
  assertion: string,
  fields: Record<string, string>,
  origin = new URL(url).origin,
): Request {
  return authorizedRequest(url, assertion, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams(fields),
  });
}

function mcpRequest(assertion: string, body: unknown = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "pipedrive_create_deal",
    arguments: { title: "Fixture", dry_run: true },
  },
}): Request {
  return authorizedRequest("https://mcp.example.test/mcp", assertion, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify(body),
  });
}

async function captureLogs<T>(run: () => Promise<T>): Promise<{ value: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (value?: unknown) => logs.push(String(value));
  try { return { value: await run(), logs }; } finally { console.log = original; }
}

async function withJwks(jwk: JsonWebKey, run: () => Promise<void>): Promise<void> {
  clearAccessJwksCache();
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === issuer && url.pathname === "/cdn-cgi/access/certs") {
      return Response.json({ keys: [jwk] });
    }
    throw new Error(`unexpected_fetch:${url}`);
  };
  try { await run(); } finally { globalThis.fetch = original; clearAccessJwksCache(); }
}

async function accessFixture(email: string, sub: string) {
  const pair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  Object.assign(jwk, { kid: `key-${sub}`, alg: "RS256", use: "sig" });
  const now = Math.floor(Date.now() / 1_000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: jwk.kid })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: issuer, aud: audience, exp: now + 300, iat: now, nbf: now - 1, sub, email,
  })));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return { jwk, assertion: `${header}.${payload}.${base64Url(new Uint8Array(signature))}` };
}

function base64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function assertPageEnvelope(response: Response): void {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'; style-src 'nonce-/);
}
