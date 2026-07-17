import type { PipedriveConfig } from "../config.js";
import { buildServer } from "../tools.js";
import { verifyAccessRequest, type AccessIdentity } from "./access.js";
import {
  ConsoleAuditSink,
  extractTargetIds,
  pseudonymizeAccessSub,
  type AuditEvent,
} from "./audit.js";
import { loadRemoteConfig, type RemoteConfig, type RemoteEnv } from "./env.js";
import {
  normalizeRemoteOAuthErrorCode,
  remoteOAuthDependencyStatus,
  remoteOAuthErrorMessage,
  remoteOAuthErrorStatus,
  type RemoteOAuthErrorCode,
} from "./oauthErrors.js";
import {
  getUserPolicy,
  userPolicyStub,
  UserPolicy,
  type UserPolicyRecord,
} from "./policy.js";
import { renderSettingsPage } from "./settingsPage.js";
import {
  renderPipedriveAdminPage,
  renderApproveConfirmation,
  renderAdminActionConfirmation,
} from "./pipedriveAdminPage.js";
import {
  TenantSecrets,
} from "./tenantSecrets.js";
import {
  TenantRegistry,
  tenantRegistryStub,
  normalizePipedriveSubdomain,
  type TenantAdminAction,
  type TenantAdminProjection,
} from "./tenantRegistry.js";
import {
  UserConnection,
  userConnectionStub,
  type UserConnectionStatus,
  type UserCredential,
} from "./userConnection.js";
import { renderUserConnectionPage } from "./userConnectionPage.js";
import { handleMcpRequest } from "./transport.js";

// TenantSecrets must stay exported so the already-declared v1 Durable Object
// class remains migration-compatible. The v2 Worker has no binding or route to it.
export { TenantRegistry, TenantSecrets, UserConnection, UserPolicy };

const auditSink = new ConsoleAuditSink();

export default {
  async fetch(request: Request, env: RemoteEnv, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return noStoreJson({ status: "ok", transport: "streamable-http" });
    }

    let config: RemoteConfig;
    let identity: AccessIdentity;
    try {
      config = loadRemoteConfig(env);
      identity = await verifyAccessRequest(request, {
        issuer: config.accessIssuer,
        audience: config.accessAudience,
      });
    } catch (error) {
      const code = safeErrorCode(error, "access_denied");
      context.waitUntil(
        auditSink.write({
          v: 1,
          ts: new Date().toISOString(),
          requestId: requestId(request),
          actorId: "anonymous",
          route: url.pathname,
          operation: "access.verify",
          effect: "read",
          outcome: "denied",
          httpStatus: 401,
          latencyMs: 0,
          errorCode: code,
        }).catch(() => undefined),
      );
      return noStoreJson(
        { code },
        { status: 401 },
      );
    }

    try {
      if (url.pathname === "/mcp") {
        return await handleRemoteMcp(request, env, identity, config, context);
      }
      if (url.pathname === "/settings") {
        return await handleSettings(request, env, identity, config, context);
      }
      if (url.pathname === "/pipedrive") {
        return await handleUserConnectionPage(request, env, identity);
      }
      if (url.pathname === "/pipedrive/connect") {
        return await handlePipedriveConnect(request, env, identity, config, context);
      }
      if (url.pathname === "/pipedrive/disconnect") {
        return await handleUserDisconnect(request, env, identity, config, context);
      }
      if (url.pathname === "/oauth/pipedrive/callback") {
        return await handlePipedriveCallback(request, env, identity, config, context);
      }
      if (url.pathname === "/admin/pipedrive") {
        if (identity.email !== config.adminEmail) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handlePipedriveAdmin(request, env, identity);
      }
      if (url.pathname === "/admin/pipedrive/approve/confirm") {
        if (identity.email !== config.adminEmail) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleApproveConfirmation(request, env, identity);
      }
      if (url.pathname === "/admin/pipedrive/action/confirm") {
        if (identity.email !== config.adminEmail) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleAdminActionConfirmation(request, env, identity);
      }
      if (url.pathname === "/admin/pipedrive/tenant") {
        if (identity.email !== config.adminEmail) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleTenantAdminAction(request, env, identity, config, context);
      }
      if (url.pathname === "/admin/pipedrive/force-disconnect") {
        if (identity.email !== config.adminEmail) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleAdminForceDisconnect(request, env, identity, config, context);
      }
    } catch (error) {
      const code = safeErrorCode(error, "remote_dependency_unavailable");
      return url.pathname === "/mcp"
        ? mcpFailure(code)
        : noStoreJson({ code }, { status: dependencyStatus(code) });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<RemoteEnv>;

async function handleRemoteMcp(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  remoteConfig: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  const startedAt = Date.now();
  const inspection = await inspectMcpRequest(request);
  const call = inspection.call;
  let credential: UserCredential;
  let policy: UserPolicyRecord;
  try {
    credential = await getUserCredential(env, identity.sub);
    policy = await getUserPolicy(env, identity.sub, credential.companyId);
  } catch (error) {
    const code = safeErrorCode(error, "remote_dependency_unavailable");
    const denied = code === "tenant_admission_denied" ||
      code === "pipedrive_not_connected" ||
      code === "pipedrive_reconnect_required";
    context.waitUntil(auditSink.write({
      v: 1,
      ts: new Date().toISOString(),
      requestId: requestId(request),
      actorId: await pseudonymizeAccessSub(identity.sub, remoteConfig.auditHmacKey),
      route: "/mcp",
      operation: call?.name ?? "mcp.admission",
      effect: call ? toolEffect(call.name) : "read",
      dryRun: call && toolEffect(call.name) !== "read" ? (call.dryRun ?? true) : undefined,
      outcome: denied ? "denied" : "error",
      httpStatus: dependencyStatus(code),
      latencyMs: Date.now() - startedAt,
      targetIds: call ? extractTargetIds(call.arguments) : undefined,
      errorCode: code,
    }).catch(() => undefined));
    if (canUseDisconnectedMcpServer(inspection.method, code)) {
      return handleMcpRequest(request, () => buildServer(disconnectedPipedriveConfig()));
    }
    throw error;
  }
  const pipedriveConfig: PipedriveConfig = {
    accessToken: credential.accessCredential,
    baseUrl: credential.apiDomain,
    baseUrlSource: "explicit",
    allowMockBaseUrl: false,
    enableWrites: policy.writes,
    enableDeleteTools: policy.deletes,
    enableMailboxTools: policy.mailbox,
    requestTimeoutMs: 10_000,
  };
  const response = await handleMcpRequest(request, () => buildServer(pipedriveConfig));

  const outcome = await mcpOutcome(response);
  if (outcome === "success" && call) {
    const usedResponse = await userConnectionStub(env, identity.sub).fetch(
      "https://connection.internal/used",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessSub: identity.sub,
          expectedGeneration: credential.generation,
        }),
      },
    );
    if (!usedResponse.ok) {
      const code = await responseErrorCode(usedResponse, "tenant_admission_denied");
      context.waitUntil(auditSink.write({
        v: 1,
        ts: new Date().toISOString(),
        requestId: requestId(request),
        actorId: await pseudonymizeAccessSub(identity.sub, remoteConfig.auditHmacKey),
        route: "/mcp",
        operation: call?.name ?? "mcp.admission",
        effect: call ? toolEffect(call.name) : "read",
        dryRun: call && toolEffect(call.name) !== "read" ? (call.dryRun ?? true) : undefined,
        // The provider response may already represent an effect. This is an
        // admission race error, not proof that the operation was denied.
        outcome: "error",
        httpStatus: dependencyStatus(code),
        latencyMs: Date.now() - startedAt,
        targetIds: call ? extractTargetIds(call.arguments) : undefined,
        tenantId: credential.tenantId,
        policyRevision: policy.revision,
        errorCode: code,
      }).catch(() => undefined));
      return mcpFailure(code);
    }
  }

  if (call) {
    const effect = toolEffect(call.name);
    const requestedDryRun = effect === "read" ? undefined : (call.dryRun ?? true);
    const denied = requestedDryRun === false && !policyAllowsCall(call.name, effect, policy);
    const event: AuditEvent = {
      v: 1,
      ts: new Date().toISOString(),
      requestId: requestId(request),
      actorId: await pseudonymizeAccessSub(identity.sub, remoteConfig.auditHmacKey),
      route: "/mcp",
      operation: call.name,
      effect,
      dryRun: denied ? true : requestedDryRun,
      outcome: denied ? "denied" : outcome,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      targetIds: extractTargetIds(call.arguments),
      tenantId: credential.tenantId,
      policyRevision: policy.revision,
      errorCode: denied ? policyDenialCode(call.name, effect, policy) : undefined,
    };
    context.waitUntil(auditSink.write(event).catch(() => undefined));
  }
  return response;
}

async function handlePipedriveAdmin(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
): Promise<Response> {
  if (request.method !== "GET") {
    return noStoreJson(
      { code: "admin_method_not_allowed" },
      { status: 405, headers: { allow: "GET" } },
    );
  }
  const registry = tenantRegistryStub(env);
  const response = await registry.fetch("https://registry.internal/admin/projection");
  if (!response.ok) {
    const code = await responseErrorCode(response, "tenant_registry_unavailable");
    return noStoreJson({ code }, { status: response.status });
  }
  const projection = await response.json<TenantAdminProjection>();
  const nonce = styleNonce();
  const url = new URL(request.url);
  return html(
    renderPipedriveAdminPage({
      projection,
      nonce,
      notice: url.searchParams.get("notice") ?? undefined,
      error: url.searchParams.get("error") ?? undefined,
    }),
    200,
    nonce,
  );
}

async function handleAdminActionConfirmation(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
): Promise<Response> {
  if (request.method !== "POST" || !hasExactOrigin(request)) {
    return noStoreJson({ code: "admin_origin_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  const action = form.get("action");
  if (action !== "suspend" && action !== "resume" && action !== "force-disconnect") {
    return noStoreJson({ code: "tenant_admin_action_invalid" }, { status: 400 });
  }
  const target = action === "force-disconnect"
    ? String(form.get("connection_ref") ?? "")
    : String(form.get("domain") ?? "");
  const actionToken = await issueRegistryAction(
    tenantRegistryStub(env),
    identity.sub,
    action,
    target,
  );
  const nonce = styleNonce();
  return html(renderAdminActionConfirmation({ action, target, actionToken, nonce }), 200, nonce);
}

async function handleApproveConfirmation(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
): Promise<Response> {
  if (request.method !== "POST" || !hasExactOrigin(request)) {
    return noStoreJson({ code: "admin_origin_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  let domain: string;
  try {
    domain = normalizePipedriveSubdomain(form.get("domain"));
  } catch {
    return noStoreJson({ code: "tenant_domain_invalid" }, { status: 400 });
  }
  const registry = tenantRegistryStub(env);
  const actionToken = await issueRegistryAction(registry, identity.sub, "approve", domain);
  const nonce = styleNonce();
  return html(renderApproveConfirmation({ domain, actionToken, nonce }), 200, nonce);
}

async function handleTenantAdminAction(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST" || !hasExactOrigin(request)) {
    return noStoreJson({ code: "admin_origin_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  if (form.get("confirm") !== "yes") {
    return noStoreJson({ code: "admin_confirmation_required" }, { status: 400 });
  }
  const action = form.get("action");
  if (action !== "approve" && action !== "suspend" && action !== "resume") {
    return noStoreJson({ code: "tenant_admin_action_invalid" }, { status: 400 });
  }
  const domain = String(form.get("domain") ?? "");
  const response = await tenantRegistryStub(env).fetch(
    `https://registry.internal/admin/${action}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adminSub: identity.sub,
        domain,
        actionToken: String(form.get("csrf") ?? ""),
      }),
    },
  );
  const code = response.ok ? undefined : await responseErrorCode(response, "tenant_registry_unavailable");
  const tenantResult: { tenantId?: unknown } = response.ok
    ? await response.clone().json<{ tenantId?: unknown }>().catch(() => ({}))
    : {};
  const tenantId = tenantResult.tenantId;
  context.waitUntil(writeOperationAudit(
    request,
    identity.sub,
    config.auditHmacKey,
    "/admin/pipedrive/tenant",
    `tenant.${action}`,
    response.ok ? "success" : "error",
    response.ok ? 303 : response.status,
    code,
    typeof tenantId === "string" ? tenantId : undefined,
  ).catch(() => undefined));
  return response.ok
    ? Response.redirect(new URL(`/admin/pipedrive?notice=${action}`, request.url), 303)
    : noStoreJson({ code }, { status: response.status });
}

async function handleAdminForceDisconnect(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST" || !hasExactOrigin(request)) {
    return noStoreJson({ code: "admin_origin_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  if (form.get("confirm") !== "yes") {
    return noStoreJson({ code: "admin_confirmation_required" }, { status: 400 });
  }
  const connectionRef = String(form.get("connection_ref") ?? "");
  const registry = tenantRegistryStub(env);
  const consumed = await registry.fetch(
    "https://registry.internal/admin/force-disconnect/consume",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adminSub: identity.sub,
        connectionRef,
        actionToken: String(form.get("csrf") ?? ""),
      }),
    },
  );
  if (!consumed.ok) {
    const code = await responseErrorCode(consumed, "tenant_admin_action_invalid");
    return noStoreJson({ code }, { status: consumed.status });
  }
  const target = await consumed.json<{
    accessSub: string;
    generation: number;
    tenantId: string;
  }>();
  const disconnected = await userConnectionStub(env, target.accessSub).fetch(
    "https://connection.internal/admin-disconnect",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessSub: target.accessSub,
        expectedGeneration: target.generation,
      }),
    },
  );
  const code = disconnected.ok
    ? undefined
    : await responseErrorCode(disconnected, "user_connection_internal_error");
  context.waitUntil(writeOperationAudit(
    request,
    identity.sub,
    config.auditHmacKey,
    "/admin/pipedrive/force-disconnect",
    "oauth.force_disconnect",
    disconnected.ok ? "success" : "error",
    disconnected.ok ? 303 : disconnected.status,
    code,
    target.tenantId,
  ).catch(() => undefined));
  return disconnected.ok
    ? Response.redirect(new URL("/admin/pipedrive?notice=force-disconnected", request.url), 303)
    : noStoreJson({ code }, { status: disconnected.status });
}

async function handleSettings(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  const credential = await getUserCredential(env, identity.sub);
  const stub = userPolicyStub(env, identity.sub, credential.companyId);
  if (request.method === "GET") {
    const [policyResponse, csrfResponse] = await Promise.all([
      stub.fetch("https://policy.internal/policy"),
      stub.fetch("https://policy.internal/csrf", { method: "POST" }),
    ]);
    if (!policyResponse.ok || !csrfResponse.ok) {
      return noStoreJson({ code: "policy_unavailable" }, { status: 503 });
    }
    const policy = await policyResponse.json<UserPolicyRecord>();
    const { csrf } = await csrfResponse.json<{ csrf: string }>();
    const nonce = styleNonce();
    return html(
      renderSettingsPage({
        email: identity.email,
        policy,
        csrf,
        nonce,
        saved: new URL(request.url).searchParams.get("saved") === "1",
      }),
      200,
      nonce,
    );
  }

  if (request.method !== "POST" || !hasExactOrigin(request)) {
    return noStoreJson({ code: "settings_request_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  const currentResponse = await stub.fetch("https://policy.internal/policy");
  if (!currentResponse.ok) {
    return noStoreJson({ code: "policy_unavailable" }, { status: 503 });
  }
  const current = await currentResponse.json<UserPolicyRecord>();
  const next = {
    writes: form.get("writes") === "yes",
    deletes: form.get("deletes") === "yes",
    mailbox: form.get("mailbox") === "yes",
    expectedRevision: Number(form.get("revision")),
  };
  const increasesAuthority =
    (!current.writes && next.writes) ||
    (!current.deletes && next.deletes) ||
    (!current.mailbox && next.mailbox);
  if (increasesAuthority && form.get("confirm") !== "yes") {
    const csrfResponse = await stub.fetch("https://policy.internal/csrf", { method: "POST" });
    const { csrf } = await csrfResponse.json<{ csrf: string }>();
    const nonce = styleNonce();
    return html(
      renderSettingsPage({
        email: identity.email,
        policy: {
          writes: next.writes,
          deletes: next.deletes,
          mailbox: next.mailbox,
          revision: current.revision,
          updatedAt: current.updatedAt,
        },
        csrf,
        nonce,
        saved: false,
        error: "Confirmez les conséquences avant d’activer une nouvelle capacité.",
      }),
      400,
      nonce,
    );
  }
  const updatedResponse = await stub.fetch("https://policy.internal/policy", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": String(form.get("csrf") ?? ""),
    },
    body: JSON.stringify(next),
  });
  if (!updatedResponse.ok) {
    return noStoreJson(
      { code: (await updatedResponse.json<{ code?: string }>()).code ?? "policy_update_failed" },
      { status: updatedResponse.status },
    );
  }
  const updated = await updatedResponse.json<UserPolicyRecord>();
  const changes = policyChanges(current, updated);
  context.waitUntil(
    writePolicyAudit(
      request,
      identity.sub,
      config.auditHmacKey,
      updated.revision,
      changes,
    ).catch(() => undefined),
  );
  return Response.redirect(new URL("/settings?saved=1", request.url), 303);
}

async function handleUserConnectionPage(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
): Promise<Response> {
  if (request.method !== "GET") {
    return noStoreJson({ code: "method_not_allowed" }, {
      status: 405,
      headers: { allow: "GET" },
    });
  }
  const stub = userConnectionStub(env, identity.sub);
  const [statusResponse, actionResponse] = await Promise.all([
    stub.fetch("https://connection.internal/status"),
    stub.fetch("https://connection.internal/self-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessSub: identity.sub }),
    }),
  ]);
  if (!statusResponse.ok || !actionResponse.ok) {
    const code = await responseErrorCode(
      statusResponse.ok ? actionResponse : statusResponse,
      "user_connection_unavailable",
    );
    return noStoreJson({ code }, { status: 503 });
  }
  const status = await statusResponse.json<UserConnectionStatus>();
  const { actionToken } = await actionResponse.json<{ actionToken: string }>();
  const nonce = styleNonce();
  const url = new URL(request.url);
  return html(renderUserConnectionPage({
    status,
    actionToken,
    nonce,
    connected: url.searchParams.get("connected") === "1",
    disconnected: url.searchParams.get("disconnected") === "1",
    error: url.searchParams.get("error") ?? undefined,
  }), 200, nonce);
}

async function handlePipedriveConnect(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST" || !hasExactOrigin(request)) {
    return noStoreJson({ code: "connection_request_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  if (form.get("confirm") !== "yes") {
    return noStoreJson({ code: "connection_confirmation_required" }, { status: 400 });
  }
  let expectedDomain: string;
  try {
    expectedDomain = normalizePipedriveSubdomain(form.get("domain"));
  } catch {
    const code = "tenant_admission_denied";
    context.waitUntil(writeOperationAudit(
      request,
      identity.sub,
      config.auditHmacKey,
      "/pipedrive/connect",
      "oauth.connect",
      "denied",
      403,
      code,
    ).catch(() => undefined));
    return Response.redirect(
      new URL(`/pipedrive?error=${encodeURIComponent(publicConnectionError(code))}`, request.url),
      303,
    );
  }
  const redirectUri = new URL("/oauth/pipedrive/callback", request.url).toString();
  const response = await userConnectionStub(env, identity.sub).fetch(
    "https://connection.internal/state",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessSub: identity.sub,
        accessEmail: identity.email,
        expectedDomain,
        redirectUri,
        actionToken: String(form.get("csrf") ?? ""),
      }),
    },
  );
  if (!response.ok) {
    const code = await responseErrorCode(response, "pipedrive_connect_failed");
    const status = response.status;
    context.waitUntil(
      writeOperationAudit(
        request,
        identity.sub,
        config.auditHmacKey,
        "/pipedrive/connect",
        "oauth.connect",
        "error",
        status,
        code as RemoteOAuthErrorCode,
      ).catch(() => undefined),
    );
    return Response.redirect(
      new URL(`/pipedrive?error=${encodeURIComponent(publicConnectionError(code))}`, request.url),
      303,
    );
  }
  const { state } = await response.json<{ state: string }>();
  const authorizationUrl = new URL("https://oauth.pipedrive.com/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", config.pipedriveClientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  context.waitUntil(
    writeOperationAudit(request, identity.sub, config.auditHmacKey, "/pipedrive/connect", "oauth.connect", "success", 302)
      .catch(() => undefined),
  );
  return Response.redirect(authorizationUrl, 302);
}

async function handlePipedriveCallback(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    return noStoreJson({ code: "method_not_allowed" }, {
      status: 405,
      headers: { allow: "GET" },
    });
  }
  const stub = userConnectionStub(env, identity.sub);
  if (url.searchParams.has("error")) {
    const redirectUri = new URL("/oauth/pipedrive/callback", request.url).toString();
    await stub.fetch("https://connection.internal/state/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessSub: identity.sub,
        state: url.searchParams.get("state") ?? "",
        redirectUri,
      }),
    }).catch(() => undefined);
    const code = "oauth_authorization_denied";
    const status = remoteOAuthErrorStatus(code);
    context.waitUntil(
      writeOperationAudit(
        request,
        identity.sub,
        config.auditHmacKey,
        "/oauth/pipedrive/callback",
        "oauth.callback",
        "error",
        status,
        code,
      ).catch(() => undefined),
    );
    return oauthFailurePage("Autorisation Pipedrive refusée", code, requestId(request), status);
  }
  const redirectUri = new URL("/oauth/pipedrive/callback", request.url).toString();
  const response = await stub.fetch("https://connection.internal/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accessSub: identity.sub,
      state: url.searchParams.get("state") ?? "",
      code: url.searchParams.get("code") ?? "",
      redirectUri,
    }),
  });
  if (!response.ok) {
    const code = await responseErrorCode(response, "user_connection_internal_error");
    const status = response.status;
    context.waitUntil(
      writeOperationAudit(
        request,
        identity.sub,
        config.auditHmacKey,
        "/oauth/pipedrive/callback",
        "oauth.callback",
        "error",
        status,
        code as RemoteOAuthErrorCode,
      )
        .catch(() => undefined),
    );
    return Response.redirect(
      new URL(`/pipedrive?error=${encodeURIComponent(publicConnectionError(code))}`, request.url),
      303,
    );
  }
  context.waitUntil(
    writeOperationAudit(request, identity.sub, config.auditHmacKey, "/oauth/pipedrive/callback", "oauth.callback", "success", 303)
      .catch(() => undefined),
  );
  return Response.redirect(new URL("/pipedrive?connected=1", request.url), 303);
}

async function handleUserDisconnect(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST" || !hasExactOrigin(request)) {
    return noStoreJson({ code: "connection_request_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  if (form.get("confirm") !== "yes") {
    return noStoreJson({ code: "connection_confirmation_required" }, { status: 400 });
  }
  const response = await userConnectionStub(env, identity.sub).fetch(
    "https://connection.internal/disconnect",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessSub: identity.sub,
        actionToken: String(form.get("csrf") ?? ""),
      }),
    },
  );
  const code = response.ok
    ? undefined
    : await responseErrorCode(response, "user_connection_internal_error");
  context.waitUntil(writeOperationAudit(
    request,
    identity.sub,
    config.auditHmacKey,
    "/pipedrive/disconnect",
    "oauth.disconnect",
    response.ok ? "success" : "error",
    response.ok ? 303 : response.status,
    code as RemoteOAuthErrorCode | undefined,
  ).catch(() => undefined));
  return response.ok
    ? Response.redirect(new URL("/pipedrive?disconnected=1", request.url), 303)
    : noStoreJson({ code }, { status: response.status });
}

async function getUserCredential(env: RemoteEnv, accessSub: string): Promise<UserCredential> {
  const response = await userConnectionStub(env, accessSub).fetch(
    "https://connection.internal/credential",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessSub }),
    },
  );
  if (!response.ok) {
    const code = await responseErrorCode(response, "pipedrive_credential_unavailable");
    throw new Error(code);
  }
  return response.json<UserCredential>();
}

async function issueRegistryAction(
  registry: DurableObjectStub,
  adminSub: string,
  action: TenantAdminAction,
  target: string,
): Promise<string> {
  const response = await registry.fetch("https://registry.internal/admin/action-ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminSub, action, target }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorCode(response, "tenant_registry_unavailable"));
  }
  const body = await response.json<{ actionToken?: unknown }>();
  if (typeof body.actionToken !== "string") {
    throw new Error("tenant_registry_unavailable");
  }
  return body.actionToken;
}

async function responseErrorCode(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json<{ code?: unknown }>();
    return typeof body.code === "string" && body.code.length > 0 ? body.code : fallback;
  } catch {
    return fallback;
  }
}

function publicConnectionError(code: string): string {
  if (
    code === "tenant_admission_denied" ||
    code === "tenant_domain_invalid" ||
    code === "tenant_domain_mismatch"
  ) {
    return "Ce domaine ne peut pas être connecté. Vérifiez-le avec l’administrateur.";
  }
  if (code === "tenant_company_mismatch") {
    return "La société Pipedrive ne correspond pas au domaine approuvé.";
  }
  if (code === "oauth_state_invalid" || code === "oauth_state_stale") {
    return "La session de connexion a expiré. Recommencez depuis cette page.";
  }
  return "La connexion Pipedrive n’a pas pu être enregistrée. Réessayez.";
}

function hasExactOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(request.url).origin;
}

async function inspectMcpRequest(request: Request): Promise<{
  method?: string;
  call?: {
    name: string;
    arguments: unknown;
    dryRun?: boolean;
  };
}> {
  try {
    const body = await request.clone().json() as {
      method?: unknown;
      params?: { name?: unknown; arguments?: unknown };
    };
    if (typeof body.method !== "string") {
      return {};
    }
    if (body.method !== "tools/call" || typeof body.params?.name !== "string") {
      return { method: body.method };
    }
    const argumentsValue = body.params.arguments;
    const dryRun =
      typeof argumentsValue === "object" &&
      argumentsValue !== null &&
      "dry_run" in argumentsValue &&
      typeof (argumentsValue as { dry_run?: unknown }).dry_run === "boolean"
        ? (argumentsValue as { dry_run: boolean }).dry_run
        : undefined;
    return {
      method: body.method,
      call: { name: body.params.name, arguments: argumentsValue, dryRun },
    };
  } catch {
    return {};
  }
}

function disconnectedPipedriveConfig(): PipedriveConfig {
  return {
    baseUrl: "",
    baseUrlSource: "missing",
    allowMockBaseUrl: false,
    enableWrites: false,
    enableDeleteTools: false,
    enableMailboxTools: false,
    requestTimeoutMs: 10_000,
  };
}

function canUseDisconnectedMcpServer(method: string | undefined, code: string): boolean {
  return (
    method !== undefined &&
    method !== "tools/call" &&
    (code === "pipedrive_not_connected" || code === "pipedrive_reconnect_required")
  );
}

function toolEffect(name: string): AuditEvent["effect"] {
  if (name.includes("_delete_")) {
    return "delete";
  }
  if (/_(?:create|update|move|mark|add|archive|convert|link|log|reschedule)_/.test(name)) {
    return "write";
  }
  return "read";
}

function policyAllowsCall(
  name: string,
  effect: AuditEvent["effect"],
  policy: UserPolicyRecord,
): boolean {
  if (effect === "read") {
    return true;
  }
  if (effect === "delete") {
    return policy.writes && policy.deletes;
  }
  if (name === "pipedrive_link_mail_thread") {
    return policy.writes && policy.mailbox;
  }
  return policy.writes;
}

function policyDenialCode(
  name: string,
  effect: AuditEvent["effect"],
  policy: UserPolicyRecord,
): string {
  if (!policy.writes) {
    return "writes_disabled";
  }
  if (effect === "delete" && !policy.deletes) {
    return "deletes_disabled";
  }
  if (name === "pipedrive_link_mail_thread" && !policy.mailbox) {
    return "mailbox_disabled";
  }
  return "permission_denied";
}

function policyChanges(
  before: UserPolicyRecord,
  after: UserPolicyRecord,
): NonNullable<AuditEvent["policyChanges"]> {
  const changes: NonNullable<AuditEvent["policyChanges"]> = {};
  for (const key of ["writes", "deletes", "mailbox"] as const) {
    if (before[key] !== after[key]) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}

async function writePolicyAudit(
  request: Request,
  sub: string,
  auditHmacKey: string,
  revision: number,
  changes: NonNullable<AuditEvent["policyChanges"]>,
): Promise<void> {
  await auditSink.write({
    v: 1,
    ts: new Date().toISOString(),
    requestId: requestId(request),
    actorId: await pseudonymizeAccessSub(sub, auditHmacKey),
    route: "/settings",
    operation: "policy.update",
    effect: "policy",
    outcome: "success",
    httpStatus: 303,
    latencyMs: 0,
    policyRevision: revision,
    policyChanges: changes,
  });
}

async function writeOperationAudit(
  request: Request,
  sub: string,
  auditHmacKey: string,
  route: string,
  operation: string,
  outcome: AuditEvent["outcome"],
  httpStatus: number,
  errorCode?: string,
  tenantId?: string,
): Promise<void> {
  await auditSink.write({
    v: 1,
    ts: new Date().toISOString(),
    requestId: requestId(request),
    actorId: await pseudonymizeAccessSub(sub, auditHmacKey),
    route,
    operation,
    effect: "oauth",
    outcome,
    httpStatus,
    latencyMs: 0,
    errorCode,
    tenantId,
  });
}

function adminRequiredResponse(
  request: Request,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Response {
  context.waitUntil(writeOperationAudit(
    request,
    identity.sub,
    config.auditHmacKey,
    new URL(request.url).pathname,
    "admin.access",
    "denied",
    403,
    "admin_required",
  ).catch(() => undefined));
  return noStoreJson({ code: "admin_required" }, { status: 403 });
}

async function mcpOutcome(response: Response): Promise<"success" | "error"> {
  if (!response.ok) {
    return "error";
  }
  try {
    const payload = await response.clone().json() as {
      error?: unknown;
      result?: { isError?: unknown };
    };
    return payload.error || payload.result?.isError === true ? "error" : "success";
  } catch {
    return "success";
  }
}

function requestId(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}

function html(body: string, status = 200, nonce?: string): Response {
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        `default-src 'none'; style-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      // Same-origin form POSTs must retain a concrete Origin for hasExactOrigin().
      // `no-referrer` makes Chromium serialize that header as `Origin: null`.
      "referrer-policy": "same-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

async function tenantFailureCode(
  response: Response,
  fallback: RemoteOAuthErrorCode = "tenant_internal_error",
): Promise<RemoteOAuthErrorCode> {
  try {
    const body = await response.json<{ code?: unknown }>();
    return normalizeRemoteOAuthErrorCode(body?.code, fallback);
  } catch {
    return fallback;
  }
}

function oauthFailurePage(
  title: string,
  code: RemoteOAuthErrorCode,
  correlationId: string,
  status: number,
): Response {
  return html(
    `<h1>${escapeHtml(title)}</h1>` +
      `<p>${escapeHtml(remoteOAuthErrorMessage(code))}</p>` +
      `<p>Code : <code>${escapeHtml(code)}</code></p>` +
      `<p>Identifiant de requête : <code>${escapeHtml(correlationId)}</code></p>`,
    status,
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function styleNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function noStoreJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function mcpFailure(code: string): Response {
  return noStoreJson(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Remote MCP dependency unavailable",
        data: { code },
      },
      id: null,
    },
    { status: dependencyStatus(code) },
  );
}

function dependencyStatus(code: string): number {
  const normalized = normalizeRemoteOAuthErrorCode(code);
  return remoteOAuthDependencyStatus(normalized);
}

function safeErrorCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[a-z0-9_:.-]{1,100}$/.test(error.message)
    ? error.message
    : fallback;
}
