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
  TenantSecrets,
  tenantSecretsStub,
  type TenantCredential,
} from "./tenantSecrets.js";
import { handleMcpRequest } from "./transport.js";

export { TenantSecrets, UserPolicy };

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
      if (url.pathname === "/admin/pipedrive/connect" && request.method === "GET") {
        if (identity.email !== config.adminEmail) {
          return noStoreJson({ code: "admin_required" }, { status: 403 });
        }
        return await handlePipedriveConnect(request, env, identity, config, context);
      }
      if (url.pathname === "/oauth/pipedrive/callback" && request.method === "GET") {
        if (identity.email !== config.adminEmail) {
          return noStoreJson({ code: "admin_required" }, { status: 403 });
        }
        return await handlePipedriveCallback(request, env, identity, config, context);
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
  const policy = await getUserPolicy(env, identity.sub);
  const credential = await getTenantCredential(env);
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
  const call = await inspectToolCall(request);
  const response = await handleMcpRequest(request, () => buildServer(pipedriveConfig));

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
      outcome: denied ? "denied" : await mcpOutcome(response),
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      targetIds: extractTargetIds(call.arguments),
      policyRevision: policy.revision,
      errorCode: denied ? policyDenialCode(call.name, effect, policy) : undefined,
    };
    context.waitUntil(auditSink.write(event).catch(() => undefined));
  }
  return response;
}

async function handleSettings(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  const stub = userPolicyStub(env, identity.sub);
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

  if (request.method !== "POST" || request.headers.get("origin") !== new URL(request.url).origin) {
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

async function handlePipedriveConnect(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  config: RemoteConfig,
  context: ExecutionContext,
): Promise<Response> {
  const redirectUri = new URL("/oauth/pipedrive/callback", request.url).toString();
  const response = await tenantSecretsStub(env).fetch("https://tenant.internal/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminSub: identity.sub, redirectUri }),
  });
  if (!response.ok) {
    const code = await tenantFailureCode(response, "pipedrive_connect_failed");
    const status = remoteOAuthErrorStatus(code);
    context.waitUntil(
      writeOperationAudit(
        request,
        identity.sub,
        config.auditHmacKey,
        "/admin/pipedrive/connect",
        "oauth.connect",
        "error",
        status,
        code,
      ).catch(() => undefined),
    );
    return oauthFailurePage("Connexion Pipedrive impossible", code, requestId(request), status);
  }
  const { state } = await response.json<{ state: string }>();
  const authorizationUrl = new URL("https://oauth.pipedrive.com/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", config.pipedriveClientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  context.waitUntil(
    writeOperationAudit(request, identity.sub, config.auditHmacKey, "/admin/pipedrive/connect", "oauth.connect", "success", 302)
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
  if (url.searchParams.has("error")) {
    const redirectUri = new URL("/oauth/pipedrive/callback", request.url).toString();
    await tenantSecretsStub(env).fetch("https://tenant.internal/state/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adminSub: identity.sub,
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
  const response = await tenantSecretsStub(env).fetch("https://tenant.internal/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      adminSub: identity.sub,
      state: url.searchParams.get("state") ?? "",
      code: url.searchParams.get("code") ?? "",
      redirectUri,
    }),
  });
  if (!response.ok) {
    const code = await tenantFailureCode(response);
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
      )
        .catch(() => undefined),
    );
    return oauthFailurePage("Connexion Pipedrive impossible", code, requestId(request), status);
  }
  context.waitUntil(
    writeOperationAudit(request, identity.sub, config.auditHmacKey, "/oauth/pipedrive/callback", "oauth.callback", "success", 200)
      .catch(() => undefined),
  );
  return html("<h1>Pipedrive est connecté</h1><p>Le serveur peut maintenant renouveler l’accès automatiquement.</p>");
}

async function getTenantCredential(env: RemoteEnv): Promise<TenantCredential> {
  const response = await tenantSecretsStub(env).fetch("https://tenant.internal/credential");
  if (!response.ok) {
    const code = await tenantFailureCode(response, "pipedrive_credential_unavailable");
    throw new Error(code);
  }
  return response.json<TenantCredential>();
}

async function inspectToolCall(request: Request): Promise<{
  name: string;
  arguments: unknown;
  dryRun?: boolean;
} | undefined> {
  try {
    const body = await request.clone().json() as {
      method?: unknown;
      params?: { name?: unknown; arguments?: unknown };
    };
    if (body.method !== "tools/call" || typeof body.params?.name !== "string") {
      return undefined;
    }
    const argumentsValue = body.params.arguments;
    const dryRun =
      typeof argumentsValue === "object" &&
      argumentsValue !== null &&
      "dry_run" in argumentsValue &&
      typeof (argumentsValue as { dry_run?: unknown }).dry_run === "boolean"
        ? (argumentsValue as { dry_run: boolean }).dry_run
        : undefined;
    return { name: body.params.name, arguments: argumentsValue, dryRun };
  } catch {
    return undefined;
  }
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
  outcome: "success" | "error",
  httpStatus: number,
  errorCode?: RemoteOAuthErrorCode,
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
  });
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
      "referrer-policy": "no-referrer",
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
