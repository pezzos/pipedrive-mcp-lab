import type { PipedriveConfig } from "../config.js";
import { boundedBody } from "../boundedBody.js";
import { buildServer } from "../tools.js";
import { verifyAccessRequest, type AccessIdentity } from "./access.js";
import {
  auditContext,
  auditV3,
  ConsoleAuditSink,
  emitAudit,
  extractTargetIds,
  pseudonymizeAccessSub,
  type AuditEventV3,
} from "./audit.js";
import { loadRemoteConfig, requestUsesConfiguredOrigin, type RemoteConfig, type RemoteEnv } from "./env.js";
import {
  normalizeRemoteOAuthErrorCode,
  remoteOAuthDependencyStatus,
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
  acquireCapacity,
  observePreviousAudit,
  releaseCapacity,
  normalizePipedriveSubdomain,
  type TenantAdminAction,
  type TenantAdminProjection,
  type AdminActionTicket,
} from "./tenantRegistry.js";
import {
  UserConnection,
  INTERNAL_AUDIT_REQUEST_ID_HEADER,
  userConnectionStub,
  type UserConnectionStatus,
  type UserCredential,
} from "./userConnection.js";
import { renderUserConnectionPage } from "./userConnectionPage.js";
import { htmlResponse, noStoreRedirect } from "./pageResponse.js";

type AuditIdentity =
  | { actorId: string; auditEpoch: string; previousActorId?: never; previousAuditEpoch?: never }
  | { actorId: string; auditEpoch: string; previousActorId: string; previousAuditEpoch: string };
import { handleMcpRequest, preflightMcpRequest } from "./transport.js";

// TenantSecrets must stay exported so the already-declared v1 Durable Object
// class remains migration-compatible. The v2 Worker has no binding or route to it.
export { TenantRegistry, TenantSecrets, UserConnection, UserPolicy };

const auditSink = new ConsoleAuditSink();
const TOOL_OPERATION_DEADLINE_MS = 12_000;
const capacitySnapshotContexts = new WeakSet<object>();
function workerTarget(env: RemoteEnv): string { return env.DEPLOY_ENVIRONMENT === "production" ? "pipedrive-mcp-production" : env.DEPLOY_ENVIRONMENT === "sandbox" ? "pipedrive-mcp-sandbox" : "pipedrive-mcp-unknown"; }
function auditContextForConfig(config: Pick<RemoteConfig, "auditContext">) { return config.auditContext; }

function isAdmin(identity: AccessIdentity, config: Pick<RemoteConfig, "adminEmail" | "adminSub">): boolean {
  return identity.email === config.adminEmail && identity.sub === config.adminSub;
}

export default {
  async fetch(request: Request, env: RemoteEnv, context: ExecutionContext): Promise<Response> {
    const protectedStartedAt = Date.now();
    if (request.url.length > 8 * 1024) return noStoreJson({ code: "remote_request_too_large" }, { status: 413 });
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (contentType.startsWith("multipart/form-data")) return noStoreJson({ code: "remote_content_type_invalid" }, { status: 415 });
    if (contentType.startsWith("application/x-www-form-urlencoded") && Number.isFinite(declaredLength) && declaredLength > 8 * 1024) {
      return noStoreJson({ code: "remote_request_too_large" }, { status: 413 });
    }
    if (contentType.startsWith("application/x-www-form-urlencoded")) {
      let body: Uint8Array; try { body = await boundedBody(request, 8 * 1024); } catch { return noStoreJson({ code: "remote_request_too_large" }, { status: 413 }); }
      request = new Request(request, { body: body.buffer as ArrayBuffer });
    }
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return noStoreJson({ status: "ok", transport: "streamable-http" });
    }

    let config: RemoteConfig;
    try {
      config = loadRemoteConfig(env);
    } catch (error) {
      const code = safeErrorCode(error, "access_denied");
      context.waitUntil(emitAudit(auditSink, { ...auditContext(env, workerTarget(env)), configDiagnostic: true }, { ts: new Date().toISOString(), category: "config", requestId: requestId(request), actorId: "anonymous", route: url.pathname, operation: "config.load", effect: "read", outcome: "denied", httpStatus: 401, latencyMs: 0, errorCode: code }));
      return noStoreJson({ code }, { status: 401 });
    }
    let identity: AccessIdentity;
    try {
      identity = await verifyAccessRequest(request, {
        issuer: config.accessIssuer,
        audience: config.accessAudience,
        ...(config.previousAccess ? { previous: config.previousAccess } : {}),
      });
    } catch (error) {
      const code = safeErrorCode(error, "access_denied");
      const jwksFailure = code === "access_jwks_unavailable" || code === "access_jwks_invalid";
      context.waitUntil(
        emitAudit(auditSink, auditContext(env, workerTarget(env)), {
          ts: new Date().toISOString(),
          requestId: requestId(request),
          actorId: "anonymous",
          category: "access",
          route: url.pathname,
          operation: "access.verify",
          effect: "read",
          outcome: jwksFailure ? "error" : "denied",
          httpStatus: jwksFailure ? 503 : 401,
          latencyMs: Date.now() - protectedStartedAt,
          errorCode: code,
        }),
      );
      return noStoreJson(
        { code },
        { status: 401 },
      );
    }

    context.waitUntil(new Promise<void>((resolve) => setTimeout(resolve, 0)).then(async () => {
      await emitAudit(auditSink, config.auditContext, {
        ts: new Date().toISOString(),
        requestId: requestId(request),
        actorId: await pseudonymizeAccessSub(identity.sub, config.auditHmacKey),
        category: "access",
        route: url.pathname,
        operation: "access.verify",
        effect: "read",
        outcome: "success",
        httpStatus: 200,
        latencyMs: Date.now() - protectedStartedAt,
      });
    }));

    if (config.previousAudit && !await previousAuditAllowed(env, config)) {
      context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), { actorId: await pseudonymizeAccessSub(identity.sub, config.auditHmacKey), ts: new Date().toISOString(), requestId: requestId(request), route: url.pathname, category: "export", operation: "audit.rotation.guard", effect: "read", outcome: "error", httpStatus: 503, latencyMs: 0, errorCode: "audit_rotation_guard_failed" }));
      return url.pathname === "/mcp" ? mcpFailure("audit_rotation_guard_failed") : noStoreJson({ code: "remote_dependency_unavailable" }, { status: 503 });
    }

    if (!requestUsesConfiguredOrigin(request, config)) {
      return noStoreJson({ code: "remote_origin_invalid" }, { status: 400 });
    }
    const capacity = await acquireCapacity(env, { kind: "protected", ip: await pseudonymizeAccessSub(request.headers.get("cf-connecting-ip") ?? "missing-ip", config.auditHmacKey), user: await pseudonymizeAccessSub(identity.sub, config.auditHmacKey) });
    emitCapacitySnapshot(request, identity, config, context, capacity.warning === true, protectedStartedAt);
    if (!capacity.admitted) { context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), { ts: new Date().toISOString(), category: "capacity", requestId: requestId(request), actorId: await pseudonymizeAccessSub(identity.sub, config.auditHmacKey), route: url.pathname, operation: "capacity.protected.denied", effect: "system", outcome: "denied", httpStatus: capacity.code === "remote_service_busy" ? 503 : 429, latencyMs: 0, errorCode: capacity.code ?? "remote_service_busy", measurements: { capacity_percent: 100 } })); return url.pathname === "/mcp" ? mcpCapacityFailure(capacity.code, capacity.retryAfter) : noStoreJson({ code: capacity.code ?? "remote_service_busy" }, { status: capacity.code === "remote_service_busy" ? 503 : 429, headers: { "retry-after": String(capacity.retryAfter ?? 1) } }); }
    try {
      if (url.pathname === "/mcp") {
        return await handleRemoteMcp(request, env, identity, config, context);
      }
      if (url.pathname === "/settings") {
        const response = await handleSettings(request, env, identity, config, context);
        if (request.method === "GET") writeGeneralRouteAudit(request, identity, config, context, response, protectedStartedAt);
        return response;
      }
      if (url.pathname === "/pipedrive") {
        const response = await handleUserConnectionPage(request, env, identity);
        writeGeneralRouteAudit(request, identity, config, context, response, protectedStartedAt);
        return response;
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
        if (!isAdmin(identity, config)) {
          return adminRequiredResponse(request, identity, config, context);
        }
        const response = await handlePipedriveAdmin(request, env, identity);
        writeGeneralRouteAudit(request, identity, config, context, response, protectedStartedAt);
        return response;
      }
      if (url.pathname === "/admin/pipedrive/approve/confirm") {
        if (!isAdmin(identity, config)) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleApproveConfirmation(request, env, identity);
      }
      if (url.pathname === "/admin/pipedrive/action/confirm") {
        if (!isAdmin(identity, config)) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleAdminActionConfirmation(request, env, identity);
      }
      if (url.pathname === "/admin/pipedrive/tenant") {
        if (!isAdmin(identity, config)) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleTenantAdminAction(request, env, identity, config, context);
      }
      if (url.pathname === "/admin/pipedrive/force-disconnect") {
        if (!isAdmin(identity, config)) {
          return adminRequiredResponse(request, identity, config, context);
        }
        return await handleAdminForceDisconnect(request, env, identity, config, context);
      }
    } catch (error) {
      const code = safeErrorCode(error, "remote_dependency_unavailable");
      const recovery = browserUiRecovery(request, url);
      const response = recovery ?? (url.pathname === "/mcp"
        ? mcpFailure(code)
        : noStoreJson({ code }, { status: dependencyStatus(code) }));
      if (url.pathname === "/pipedrive" || (url.pathname === "/settings" && request.method === "GET") || url.pathname === "/admin/pipedrive") {
        writeGeneralRouteAudit(request, identity, config, context, response, protectedStartedAt, code);
      }
      return response;
    }

    const response = new Response("Not found", { status: 404 });
    writeGeneralRouteAudit(request, identity, config, context, response, protectedStartedAt, "remote_route_not_found");
    return response;
  },
  async scheduled(_event: ScheduledController, env: RemoteEnv, context: ExecutionContext): Promise<void> {
    // This is source emission only. Logpush/R2 durability is deliberately not implied here.
    context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), { ts: new Date().toISOString(), category: "export", requestId: "scheduled-heartbeat", actorId: "system", route: "scheduled", operation: "audit.export.heartbeat", effect: "system", outcome: "success", httpStatus: 200, latencyMs: 0, measurements: { freshness_seconds: 0 } }));
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
  const inheritedRequestId = requestId(request);
  const preflight = await preflightMcpRequest(request);
  if ("response" in preflight) return preflight.response;
  request = preflight.request;
  requestIds.set(request, inheritedRequestId);
  const inspection = await inspectMcpRequest(request);
  const call = inspection.call;
  const mcpCapacity = await acquireCapacity(env, { kind: "mcp", ip: await pseudonymizeAccessSub(request.headers.get("cf-connecting-ip") ?? "missing-ip", remoteConfig.auditHmacKey), user: await pseudonymizeAccessSub(identity.sub, remoteConfig.auditHmacKey) });
  emitCapacitySnapshot(request, identity, remoteConfig, context, mcpCapacity.warning === true, startedAt);
  if (!mcpCapacity.admitted) { context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), { ts: new Date().toISOString(), category: "capacity", requestId: requestId(request), actorId: await pseudonymizeAccessSub(identity.sub, remoteConfig.auditHmacKey), route: "/mcp", operation: "capacity.mcp.denied", effect: "system", outcome: "denied", httpStatus: 429, latencyMs: Date.now()-startedAt, errorCode: mcpCapacity.code ?? "remote_service_busy", measurements: { capacity_percent: 100 } })); return mcpCapacityFailure(mcpCapacity.code, mcpCapacity.retryAfter); }
  let credential: UserCredential;
  let policy: UserPolicyRecord;
  try {
    credential = await getUserCredential(env, identity.sub, request);
    policy = await getUserPolicy(env, identity.sub, credential.companyId);
  } catch (error) {
    const code = safeErrorCode(error, "remote_dependency_unavailable");
    const denied = code === "tenant_admission_denied" ||
      code === "pipedrive_not_connected" ||
      code === "pipedrive_reconnect_required";
    context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), {
      ...(await auditIdentity(identity.sub, remoteConfig)),
      category: "tenant",
      ts: new Date().toISOString(),
      requestId: requestId(request),
      route: "/mcp",
      operation: call?.name ?? "mcp.admission",
      effect: call ? toolEffect(call.name) : "read",
      dryRun: call && toolEffect(call.name) !== "read" ? (call.dryRun ?? true) : undefined,
      outcome: denied ? "denied" : "error",
      httpStatus: dependencyStatus(code),
      latencyMs: Date.now() - startedAt,
      targetIds: call ? extractTargetIds(call.arguments) : undefined,
      errorCode: code,
    }));
    if (canUseDisconnectedMcpServer(inspection.method, code)) {
      return handleMcpRequest(request, () => buildServer(disconnectedPipedriveConfig()));
    }
    throw error;
  }
  const providerIdentity = await auditIdentity(identity.sub, remoteConfig);
  const pipedriveConfig: PipedriveConfig = {
    accessToken: credential.accessCredential,
    baseUrl: credential.apiDomain,
    baseUrlSource: "explicit",
    allowMockBaseUrl: false,
    enableWrites: policy.writes,
    enableDeleteTools: policy.deletes,
    enableMailboxTools: policy.mailbox,
    requestTimeoutMs: 10_000,
    providerObserver: (provider) => context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), { ...providerIdentity, ts: new Date().toISOString(), category: "provider", requestId: requestId(request), route: "/mcp", operation: "provider.observe", effect: "system", outcome: "error", httpStatus: provider.status ?? 504, latencyMs: provider.latencyMs, providerStatus: provider.status, providerClass: provider.class, attempt: provider.attempt })),
  };
  let toolLease: string | undefined;
  let toolDeadline: ReturnType<typeof setTimeout> | undefined;
  let toolAbort: AbortController | undefined;
  let execution: Promise<Response> | undefined;
  if (call) {
    const toolCapacity = await acquireCapacity(env, { kind: "tool", ip: await pseudonymizeAccessSub(request.headers.get("cf-connecting-ip") ?? "missing-ip", remoteConfig.auditHmacKey), user: await pseudonymizeAccessSub(identity.sub, remoteConfig.auditHmacKey), tenant: credential.tenantId });
    emitCapacitySnapshot(request, identity, remoteConfig, context, toolCapacity.warning === true, startedAt);
    if (!toolCapacity.admitted) { context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), { ...providerIdentity, ts: new Date().toISOString(), category: "capacity", requestId: requestId(request), route: "/mcp", operation: "capacity.tool.denied", effect: "system", outcome: "denied", httpStatus: 429, latencyMs: Date.now()-startedAt, errorCode: toolCapacity.code ?? "remote_service_busy", measurements: { capacity_percent: 100 } })); return mcpCapacityFailure(toolCapacity.code, toolCapacity.retryAfter); }
    if (!toolCapacity.lease) { context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), { ...providerIdentity, ts: new Date().toISOString(), category: "capacity", requestId: requestId(request), route: "/mcp", operation: "capacity.tool.lease_missing", effect: "system", outcome: "error", httpStatus: 503, latencyMs: Date.now()-startedAt, errorCode: "remote_service_busy" })); return mcpCapacityFailure("remote_service_busy", 1); }
    toolLease = toolCapacity.lease;
    toolAbort = new AbortController();
    toolDeadline = setTimeout(() => toolAbort?.abort(), TOOL_OPERATION_DEADLINE_MS);
    pipedriveConfig.operationSignal = toolAbort.signal;
  }
  try {
  execution = handleMcpRequest(request, () => buildServer(pipedriveConfig));
  const response = await (toolAbort ? Promise.race([
    execution,
    new Promise<Response>((resolve) => toolAbort?.signal.addEventListener("abort", () => resolve(mcpFailure("pipedrive_operation_deadline_exceeded")), { once: true })),
  ]) : execution);

  const outcome = await mcpOutcome(response);
  if (outcome === "success" && call) {
    const usedResponse = await userConnectionStub(env, identity.sub).fetch(
      "https://connection.internal/used",
      {
        method: "POST",
        headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
        signal: toolAbort?.signal,
        body: JSON.stringify({
          accessSub: identity.sub,
          expectedGeneration: credential.generation,
        }),
      },
    );
    if (!usedResponse.ok) {
      const code = await responseErrorCode(usedResponse, "tenant_admission_denied");
      context.waitUntil(emitAudit(auditSink, auditContext(env, workerTarget(env)), {
        ...(await auditIdentity(identity.sub, remoteConfig)),
        category: "tenant",
        ts: new Date().toISOString(),
        requestId: requestId(request),
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
      }));
      return mcpFailure(code);
    }
  }

  if (call) {
    const effect = toolEffect(call.name);
    const requestedDryRun = effect === "read" ? undefined : (call.dryRun ?? true);
    const denied = requestedDryRun === false && !policyAllowsCall(call.name, effect, policy);
    const event: AuditEventV3 = auditV3(auditContext(env, workerTarget(env)), {
      ...(await auditIdentity(identity.sub, remoteConfig)),
      category: "route",
      ts: new Date().toISOString(),
      requestId: requestId(request),
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
    });
    context.waitUntil(auditSink.write(event).catch(() => undefined));
  }
  return response;
  } finally {
    if (toolDeadline) clearTimeout(toolDeadline);
    if (toolAbort?.signal.aborted && execution) await execution.catch(() => undefined);
    if (toolLease) await releaseCapacity(env, toolLease);
  }
}

async function previousAuditAllowed(env: RemoteEnv, config: RemoteConfig): Promise<boolean> {
  if (!config.previousAudit) return true;
  const bytes = Uint8Array.from(atob(config.previousAudit.key.replaceAll("-", "+").replaceAll("_", "/") + "="), (c) => c.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return observePreviousAudit(env, { epoch: config.previousAudit.epoch, fingerprint, validUntilMs: config.previousAudit.validUntilMs });
}

function mcpCapacityFailure(code: string | undefined, retryAfter: number | undefined): Response {
  const safeCode = code === "remote_rate_limited" || code === "pilot_daily_capacity_exceeded" ? code : "remote_service_busy";
  return Response.json({ jsonrpc: "2.0", error: { code: -32600, message: safeCode }, id: null }, { status: safeCode === "remote_service_busy" ? 503 : 429, headers: { "cache-control": "no-store", "content-type": "application/json", "retry-after": String(Math.max(1, Math.min(86_400, retryAfter ?? 1))) } });
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
  const url = new URL(request.url);
  const response = await registry.fetch("https://registry.internal/admin/projection");
  if (!response.ok) {
    if (adminError(url.searchParams.get("error")) === "registry") {
      const nonce = styleNonce();
      return htmlResponse(renderPipedriveAdminPage({ projection: emptyAdminProjection(), nonce, error: "registry" }), 503, nonce);
    }
    return noStoreRedirect(new URL("/admin/pipedrive?error=registry", request.url), 303);
  }
  const projection = await response.json<TenantAdminProjection>();
  const nonce = styleNonce();
  return htmlResponse(
    renderPipedriveAdminPage({
      projection,
      nonce,
      notice: adminNotice(url.searchParams.get("notice")),
      error: adminError(url.searchParams.get("error")),
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
  let ticket: AdminActionTicket;
  try { ticket = await issueRegistryAction(tenantRegistryStub(env), identity.sub, action, target); } catch { return noStoreRedirect(new URL("/admin/pipedrive?error=ticket", request.url), 303); }
  const nonce = styleNonce();
  if (action === "force-disconnect" && !ticket.forceDisconnectTarget) {
    return noStoreJson({ code: "tenant_registry_unavailable" }, { status: 503 });
  }
  return htmlResponse(renderAdminActionConfirmation({
    action,
    target,
    actionToken: ticket.actionToken,
    nonce,
    ...(ticket.forceDisconnectTarget ? { forceTarget: ticket.forceDisconnectTarget } : {}),
  }), 200, nonce);
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
    return noStoreRedirect(new URL("/admin/pipedrive?error=conflict", request.url), 303);
  }
  const registry = tenantRegistryStub(env);
  let ticket: AdminActionTicket;
  try { ticket = await issueRegistryAction(registry, identity.sub, "approve", domain); } catch { return noStoreRedirect(new URL("/admin/pipedrive?error=ticket", request.url), 303); }
  const nonce = styleNonce();
  return htmlResponse(renderApproveConfirmation({ domain, actionToken: ticket.actionToken, nonce }), 200, nonce);
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
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
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
    config,
    "/admin/pipedrive/tenant",
    `tenant.${action}`,
    response.ok ? "success" : "error",
    response.ok ? 303 : response.status,
    code,
    typeof tenantId === "string" ? tenantId : undefined,
  ).catch(() => undefined));
  return response.ok
    ? noStoreRedirect(new URL(`/admin/pipedrive?notice=${action}`, request.url), 303)
    : noStoreRedirect(new URL(`/admin/pipedrive?error=${code === "tenant_registry_conflict" ? "conflict" : "ticket"}`, request.url), 303);
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
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
      body: JSON.stringify({
        adminSub: identity.sub,
        connectionRef,
        actionToken: String(form.get("csrf") ?? ""),
      }),
    },
  );
  if (!consumed.ok) {
    return noStoreRedirect(new URL("/admin/pipedrive?error=ticket", request.url), 303);
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
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
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
    config,
    "/admin/pipedrive/force-disconnect",
    "oauth.force_disconnect",
    disconnected.ok ? "success" : "error",
    disconnected.ok ? 303 : disconnected.status,
    code,
    target.tenantId,
  ).catch(() => undefined));
  return disconnected.ok
    ? noStoreRedirect(new URL("/admin/pipedrive?notice=force-disconnected", request.url), 303)
    : noStoreRedirect(new URL("/admin/pipedrive?error=conflict", request.url), 303);
}

async function handleSettings(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  const startedAt = Date.now();
  if (request.method === "GET" && new URL(request.url).searchParams.get("error") === "policy") {
    return noStoreRedirect(new URL("/pipedrive?notice=storage", request.url), 303);
  }
  let credential: UserCredential;
  try {
    credential = await getUserCredential(env, identity.sub, request);
  } catch (error) {
    if (request.method === "GET" || (request.method === "POST" && hasExactOrigin(request))) {
      const code = safeErrorCode(error, "pipedrive_credential_unavailable");
      if (request.method === "POST") context.waitUntil(writePolicyAudit(request, identity.sub, config, 0, {}, "error", 503, code, Date.now()-startedAt).catch(() => undefined));
      const notice = code === "pipedrive_not_connected" ? "not-connected" : code === "pipedrive_reconnect_required" ? "reconnect" : "storage";
      return noStoreRedirect(new URL(`/pipedrive?notice=${notice}`, request.url), 303);
    }
    return noStoreJson({ code: "settings_request_invalid" }, { status: 403 });
  }
  const stub = userPolicyStub(env, identity.sub, credential.companyId);
  if (request.method === "GET") {
    const [policyResponse, csrfResponse] = await Promise.all([
      stub.fetch("https://policy.internal/policy"),
      stub.fetch("https://policy.internal/csrf", { method: "POST" }),
    ]);
    if (!policyResponse.ok || !csrfResponse.ok) {
      return noStoreRedirect(new URL("/settings?error=policy", request.url), 303);
    }
    const policy = await policyResponse.json<UserPolicyRecord>();
    const { csrf } = await csrfResponse.json<{ csrf: string }>();
    const nonce = styleNonce();
    return htmlResponse(
      renderSettingsPage({
        email: identity.email,
        company: credential.companyName,
        domain: credential.domain,
        policy,
        csrf,
        nonce,
        saved: new URL(request.url).searchParams.get("saved") === "1",
        error: settingsError(new URL(request.url).searchParams.get("error")),
      }),
      200,
      nonce,
    );
  }

  if (request.method !== "POST" || !hasExactOrigin(request)) {
    context.waitUntil(writePolicyAudit(request, identity.sub, config, 0, {}, "denied", 403, "settings_request_invalid", Date.now()-startedAt).catch(() => undefined));
    return noStoreJson({ code: "settings_request_invalid" }, { status: 403 });
  }
  const form = await request.formData();
  const currentResponse = await stub.fetch("https://policy.internal/policy");
  if (!currentResponse.ok) {
    context.waitUntil(writePolicyAudit(request, identity.sub, config, 0, {}, "error", 503, "user_policy_unavailable", Date.now()-startedAt).catch(() => undefined));
    return noStoreRedirect(new URL("/settings?error=policy", request.url), 303);
  }
  const current = await currentResponse.json<UserPolicyRecord>();
  const requestedWrites = form.get("writes") === "yes";
  const next = {
    writes: requestedWrites,
    deletes: requestedWrites && form.get("deletes") === "yes",
    mailbox: form.get("mailbox") === "yes",
    expectedRevision: Number(form.get("revision")),
  };
  const increasesAuthority =
    (!current.writes && next.writes) ||
    (!current.deletes && next.deletes) ||
    (!current.mailbox && next.mailbox);
  if (increasesAuthority && form.get("confirm") !== "yes") {
    const csrfResponse = await stub.fetch("https://policy.internal/csrf", { method: "POST" });
    if (!csrfResponse.ok) {
      context.waitUntil(writePolicyAudit(request, identity.sub, config, current.revision, {}, "error", 503, "user_policy_unavailable", Date.now()-startedAt).catch(() => undefined));
      return noStoreRedirect(new URL("/settings?error=policy", request.url), 303);
    }
    const csrfResult: { csrf?: unknown } = await csrfResponse.json<{ csrf?: unknown }>()
      .catch(() => ({} as { csrf?: unknown }));
    if (typeof csrfResult.csrf !== "string" || csrfResult.csrf.length === 0) {
      context.waitUntil(writePolicyAudit(request, identity.sub, config, current.revision, {}, "error", 503, "user_policy_unavailable", Date.now()-startedAt).catch(() => undefined));
      return noStoreRedirect(new URL("/settings?error=policy", request.url), 303);
    }
    const nonce = styleNonce();
    context.waitUntil(writePolicyAudit(request, identity.sub, config, current.revision, {}, "denied", 400, "policy_confirmation_required", Date.now()-startedAt).catch(() => undefined));
    return htmlResponse(
      renderSettingsPage({
        email: identity.email,
        company: credential.companyName,
        domain: credential.domain,
        policy: {
          writes: next.writes,
          deletes: next.deletes,
          mailbox: next.mailbox,
          revision: current.revision,
          updatedAt: current.updatedAt,
        },
        csrf: csrfResult.csrf,
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
    const code = await responseErrorCode(updatedResponse, "user_policy_unavailable");
    const denied = code === "user_policy_conflict" || code === "user_action_invalid";
    context.waitUntil(writePolicyAudit(request, identity.sub, config, current.revision, {}, denied ? "denied" : "error", updatedResponse.status, code, Date.now()-startedAt).catch(() => undefined));
    return noStoreRedirect(new URL("/settings?error=conflict", request.url), 303);
  }
  const updated = await updatedResponse.json<UserPolicyRecord>();
  const changes = policyChanges(current, updated);
  context.waitUntil(
    writePolicyAudit(
      request,
      identity.sub,
      config,
      updated.revision,
      changes,
      "success", 303, undefined, Date.now()-startedAt,
    ).catch(() => undefined),
  );
  return noStoreRedirect(new URL("/settings?saved=1", request.url), 303);
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
    stub.fetch("https://connection.internal/status", { headers: internalConnectionHeaders(request) }),
    stub.fetch("https://connection.internal/self-action", {
      method: "POST",
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
      body: JSON.stringify({ accessSub: identity.sub }),
    }),
  ]);
  if (!statusResponse.ok || !actionResponse.ok) {
    const code = await responseErrorCode(
      statusResponse.ok ? actionResponse : statusResponse,
      "user_connection_unavailable",
    );
    const nonce = styleNonce();
    return htmlResponse(renderUserConnectionPage({ status: { connected: false, reconnectRequired: false, generation: 0 }, actionToken: "", nonce, notice: "storage" }), 503, nonce);
  }
  const status = await statusResponse.json<UserConnectionStatus>();
  const { actionToken } = await actionResponse.json<{ actionToken: string }>();
  const nonce = styleNonce();
  const url = new URL(request.url);
  return htmlResponse(renderUserConnectionPage({
    status,
    actionToken,
    nonce,
    notice: userConnectionNotice(url.searchParams.get("notice")),
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
      config,
      "/pipedrive/connect",
      "oauth.connect",
      "denied",
      403,
      code,
    ).catch(() => undefined));
    return noStoreRedirect(
      new URL(`/pipedrive?notice=${connectionNoticeForCode(code)}`, request.url),
      303,
    );
  }
  const redirectUri = config.oauthCallbackUrl;
  const response = await userConnectionStub(env, identity.sub).fetch(
    "https://connection.internal/state",
    {
      method: "POST",
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
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
        config,
        "/pipedrive/connect",
        "oauth.connect",
        "error",
        status,
        code as RemoteOAuthErrorCode,
      ).catch(() => undefined),
    );
    return noStoreRedirect(
      new URL(`/pipedrive?notice=${connectionNoticeForCode(code)}`, request.url),
      303,
    );
  }
  const { state } = await response.json<{ state: string }>();
  const authorizationUrl = new URL("https://oauth.pipedrive.com/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", config.pipedriveClientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  context.waitUntil(
    writeOperationAudit(request, identity.sub, config, "/pipedrive/connect", "oauth.connect", "success", 302)
      .catch(() => undefined),
  );
  return noStoreRedirect(authorizationUrl, 302);
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
    const redirectUri = config.oauthCallbackUrl;
    await stub.fetch("https://connection.internal/state/discard", {
      method: "POST",
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
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
        config,
        "/oauth/pipedrive/callback",
        "oauth.callback",
        "error",
        status,
        code,
      ).catch(() => undefined),
    );
    return noStoreRedirect(new URL("/pipedrive?notice=oauth-cancelled", request.url), 303);
  }
  const redirectUri = config.oauthCallbackUrl;
  const response = await stub.fetch("https://connection.internal/exchange", {
    method: "POST",
    headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
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
        config,
        "/oauth/pipedrive/callback",
        "oauth.callback",
        "error",
        status,
        code as RemoteOAuthErrorCode,
      )
        .catch(() => undefined),
    );
    return noStoreRedirect(
      new URL(`/pipedrive?notice=${connectionNoticeForCode(code)}`, request.url),
      303,
    );
  }
  context.waitUntil(
    writeOperationAudit(request, identity.sub, config, "/oauth/pipedrive/callback", "oauth.callback", "success", 303)
      .catch(() => undefined),
  );
  return noStoreRedirect(new URL("/pipedrive?notice=connected", request.url), 303);
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
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
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
    config,
    "/pipedrive/disconnect",
    "oauth.disconnect",
    response.ok ? "success" : "error",
    response.ok ? 303 : response.status,
    code as RemoteOAuthErrorCode | undefined,
  ).catch(() => undefined));
  return response.ok
    ? noStoreRedirect(new URL("/pipedrive?notice=disconnected", request.url), 303)
    : noStoreRedirect(new URL(`/pipedrive?notice=${code === "user_action_invalid" ? "csrf" : "storage"}`, request.url), 303);
}

async function getUserCredential(env: RemoteEnv, accessSub: string, request: Request): Promise<UserCredential> {
  const response = await userConnectionStub(env, accessSub).fetch(
    "https://connection.internal/credential",
    {
      method: "POST",
      headers: internalConnectionHeaders(request, { "content-type": "application/json" }),
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
): Promise<AdminActionTicket> {
  const response = await registry.fetch("https://registry.internal/admin/action-ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminSub, action, target }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorCode(response, "tenant_registry_unavailable"));
  }
  const body = await response.json<AdminActionTicket>();
  if (typeof body.actionToken !== "string") {
    throw new Error("tenant_registry_unavailable");
  }
  return body;
}

async function responseErrorCode(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json<{ code?: unknown }>();
    return typeof body.code === "string" && body.code.length > 0 ? body.code : fallback;
  } catch {
    return fallback;
  }
}

function connectionNoticeForCode(code: string): string {
  if (code === "tenant_admission_denied" || code === "tenant_domain_invalid" || code === "tenant_domain_mismatch") return "admission";
  if (code === "tenant_company_mismatch") return "company-mismatch";
  if (code === "oauth_state_invalid" || code === "oauth_state_stale" || code === "user_connection_conflict") return "conflict";
  if (code === "user_action_invalid" || code === "connection_confirmation_required") return "csrf";
  if (code === "tenant_storage_unavailable" || code === "user_connection_unavailable") return "storage";
  return "oauth-error";
}

function userConnectionNotice(value: string | null): import("./userConnectionPage.js").UserConnectionNotice | undefined {
  return value === "connected" || value === "disconnected" || value === "not-connected" || value === "reconnect" || value === "admission" || value === "company-mismatch" || value === "oauth-cancelled" || value === "oauth-error" || value === "conflict" || value === "csrf" || value === "storage" ? value : undefined;
}

function adminNotice(value: string | null): import("./pipedriveAdminPage.js").AdminNotice | undefined {
  return value === "approve" || value === "suspend" || value === "resume" || value === "force-disconnected" ? value : undefined;
}

function adminError(value: string | null): "ticket" | "registry" | "conflict" | undefined {
  return value === "ticket" || value === "registry" || value === "conflict" ? value : undefined;
}

function settingsError(value: string | null): string | undefined {
  if (value === "policy") return "Les permissions ne sont pas disponibles pour le moment. Réessayez plus tard.";
  if (value === "conflict") return "Vos permissions ont changé. Rechargez la page avant de recommencer.";
  return undefined;
}

function browserUiRecovery(request: Request, url: URL): Response | undefined {
  const sameOriginPost = request.method === "POST" && hasExactOrigin(request);
  const isGet = request.method === "GET";
  if (!isGet && !sameOriginPost) return undefined;
  if (url.pathname === "/pipedrive") {
    const nonce = styleNonce();
    return htmlResponse(
      renderUserConnectionPage({
        status: { connected: false, reconnectRequired: false, generation: 0 },
        actionToken: "",
        nonce,
        notice: "storage",
      }),
      503,
      nonce,
    );
  }
  if (url.pathname === "/pipedrive/connect" || url.pathname === "/pipedrive/disconnect") {
    return noStoreRedirect(new URL("/pipedrive?notice=storage", request.url), 303);
  }
  if (url.pathname === "/oauth/pipedrive/callback") {
    return noStoreRedirect(new URL("/pipedrive?notice=oauth-error", request.url), 303);
  }
  if (url.pathname === "/settings") {
    return noStoreRedirect(new URL("/pipedrive?notice=storage", request.url), 303);
  }
  if (url.pathname === "/admin/pipedrive") {
    const nonce = styleNonce();
    return htmlResponse(
      renderPipedriveAdminPage({ projection: emptyAdminProjection(), nonce, error: "registry" }),
      503,
      nonce,
    );
  }
  if (url.pathname === "/admin/pipedrive/approve/confirm" || url.pathname === "/admin/pipedrive/action/confirm" || url.pathname === "/admin/pipedrive/tenant" || url.pathname === "/admin/pipedrive/force-disconnect") {
    return noStoreRedirect(new URL("/admin/pipedrive?error=ticket", request.url), 303);
  }
  return undefined;
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

function toolEffect(name: string): AuditEventV3["effect"] {
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
  effect: AuditEventV3["effect"],
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
  effect: AuditEventV3["effect"],
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
): NonNullable<AuditEventV3["policyChanges"]> {
  const changes: NonNullable<AuditEventV3["policyChanges"]> = {};
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
  audit: Pick<RemoteConfig, "auditHmacKey" | "auditHmacEpoch" | "previousAudit" | "auditContext">,
  revision: number,
  changes: NonNullable<AuditEventV3["policyChanges"]>,
  outcome: AuditEventV3["outcome"] = "success", httpStatus = 303, errorCode?: string, latencyMs = 0,
): Promise<void> {
  await emitAudit(auditSink, auditContextForConfig(audit), {
    ...(await auditIdentity(sub, audit)),
    category: "authority",
    ts: new Date().toISOString(),
    requestId: requestId(request),
    route: "/settings",
    operation: "policy.update",
    effect: "policy",
    outcome, httpStatus, latencyMs, errorCode,
    policyRevision: revision,
    policyChanges: changes,
  });
}

async function writeOperationAudit(
  request: Request,
  sub: string,
  audit: Pick<RemoteConfig, "auditHmacKey" | "auditHmacEpoch" | "previousAudit" | "auditContext">,
  route: string,
  operation: string,
  outcome: AuditEventV3["outcome"],
  httpStatus: number,
  errorCode?: string,
  tenantId?: string,
): Promise<void> {
  await emitAudit(auditSink, auditContextForConfig(audit), {
    ...(await auditIdentity(sub, audit)),
    category: "oauth",
    ts: new Date().toISOString(),
    requestId: requestId(request),
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

function writeGeneralRouteAudit(
  request: Request,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
  response: Response,
  startedAt: number,
  errorCode?: string,
): void {
  const outcome = errorCode === undefined
    ? (response.ok || response.status < 400
    ? "success"
    : response.status < 500 ? "denied" : "error")
    : routeErrorOutcome(errorCode);
  context.waitUntil((async () => {
    await emitAudit(auditSink, config.auditContext, {
      ts: new Date().toISOString(),
      requestId: requestId(request),
      actorId: await pseudonymizeAccessSub(identity.sub, config.auditHmacKey),
      category: "route",
      route: new URL(request.url).pathname,
      operation: "route.outcome",
      effect: "read",
      outcome,
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      ...(errorCode === undefined ? {} : { errorCode }), measurements: { request_count: 1 },
    });
  })().catch(() => undefined));
}

function routeErrorOutcome(errorCode: string): AuditEventV3["outcome"] {
  return new Set([
    "admin_confirmation_required", "admin_method_not_allowed", "admin_origin_invalid", "admin_required",
    "connection_request_invalid", "oauth_authorization_denied", "oauth_state_invalid", "oauth_state_stale",
    "policy_confirmation_required", "remote_content_type_invalid", "remote_origin_invalid", "remote_request_too_large",
    "remote_route_not_found", "settings_request_invalid", "tenant_admission_denied", "tenant_company_mismatch",
    "tenant_domain_invalid", "tenant_domain_mismatch", "user_action_invalid", "user_connection_conflict", "user_policy_conflict",
  ]).has(errorCode) ? "denied" : "error";
}

function emitCapacitySnapshot(
  request: Request,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
  warning: boolean,
  startedAt: number,
): void {
  if (!warning || capacitySnapshotContexts.has(context as object)) return;
  capacitySnapshotContexts.add(context as object);
  context.waitUntil((async () => {
    await emitAudit(auditSink, config.auditContext, {
      ts: new Date().toISOString(),
      requestId: requestId(request),
      actorId: await pseudonymizeAccessSub(identity.sub, config.auditHmacKey),
      category: "capacity",
      route: new URL(request.url).pathname,
      operation: "capacity.snapshot",
      effect: "system",
      outcome: "success",
      httpStatus: 200,
      latencyMs: Date.now() - startedAt,
      measurements: { capacity_percent: 80 },
    });
  })().catch(() => undefined));
}

async function auditIdentity(
  sub: string,
  audit: Pick<RemoteConfig, "auditHmacKey" | "auditHmacEpoch" | "previousAudit">,
): Promise<AuditIdentity> {
  const actorId = await pseudonymizeAccessSub(sub, audit.auditHmacKey);
  if (!audit.previousAudit || Date.now() >= audit.previousAudit.validUntilMs) return { actorId, auditEpoch: audit.auditHmacEpoch };
  return {
    actorId,
    auditEpoch: audit.auditHmacEpoch,
    previousActorId: await pseudonymizeAccessSub(sub, audit.previousAudit.key),
    previousAuditEpoch: audit.previousAudit.epoch,
  };
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
    config,
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

const requestIds = new WeakMap<Request, string>();
const safeRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

function requestId(request: Request): string {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const ray = request.headers.get("cf-ray");
  const value = ray !== null && safeRequestId.test(ray) ? ray : crypto.randomUUID();
  requestIds.set(request, value);
  return value;
}

function internalConnectionHeaders(request: Request, headers: HeadersInit = {}): Headers {
  const merged = new Headers(headers);
  merged.set(INTERNAL_AUDIT_REQUEST_ID_HEADER, requestId(request));
  return merged;
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

function styleNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function emptyAdminProjection(): TenantAdminProjection {
  return {
    tenants: [],
    connections: [],
    encryptionReceipt: {
      generatedAtMs: Date.now(),
      currentKeyStates: { primary: 0, old: 0, legacy: 0, unknown: 0 },
    },
  };
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
