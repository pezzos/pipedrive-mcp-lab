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
      return noStoreJson(
        { code: safeErrorCode(error, "access_denied") },
        { status: 401 },
      );
    }

    if (url.pathname === "/mcp") {
      return handleRemoteMcp(request, env, identity, context);
    }
    if (url.pathname === "/settings") {
      return handleSettings(request, env, identity, context);
    }
    if (url.pathname === "/admin/pipedrive/connect" && request.method === "GET") {
      if (identity.email !== config.adminEmail) {
        return noStoreJson({ code: "admin_required" }, { status: 403 });
      }
      return handlePipedriveConnect(request, env, identity, config, context);
    }
    if (url.pathname === "/oauth/pipedrive/callback" && request.method === "GET") {
      if (identity.email !== config.adminEmail) {
        return noStoreJson({ code: "admin_required" }, { status: 403 });
      }
      return handlePipedriveCallback(request, env, identity, context);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<RemoteEnv>;

async function handleRemoteMcp(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  context: ExecutionContext,
): Promise<Response> {
  const startedAt = Date.now();
  const policy = await getUserPolicy(env, identity.sub);
  const credential = await getTenantCredential(env);
  const pipedriveConfig: PipedriveConfig = {
    accessToken: credential?.accessCredential,
    baseUrl: credential?.apiDomain ?? "",
    baseUrlSource: credential ? "explicit" : "missing",
    allowMockBaseUrl: false,
    enableWrites: policy.writes,
    enableDeleteTools: policy.deletes,
    enableMailboxTools: policy.mailbox,
    requestTimeoutMs: 10_000,
  };
  const call = await inspectToolCall(request);
  const response = await handleMcpRequest(request, () => buildServer(pipedriveConfig));

  if (call) {
    const event: AuditEvent = {
      v: 1,
      ts: new Date().toISOString(),
      requestId: requestId(request),
      actorId: await pseudonymizeAccessSub(identity.sub),
      route: "/mcp",
      operation: call.name,
      effect: toolEffect(call.name),
      dryRun: call.dryRun,
      outcome: await mcpOutcome(response),
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      targetIds: extractTargetIds(call.arguments),
      policyRevision: policy.revision,
    };
    context.waitUntil(auditSink.write(event).catch(() => undefined));
  }
  return response;
}

async function handleSettings(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
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
        policy: current,
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
    writePolicyAudit(request, identity.sub, updated.revision, changes).catch(() => undefined),
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
    return noStoreJson({ code: "pipedrive_connect_failed" }, { status: 503 });
  }
  const { state } = await response.json<{ state: string }>();
  const authorizationUrl = new URL("https://oauth.pipedrive.com/oauth/authorize");
  authorizationUrl.searchParams.set("client_id", config.pipedriveClientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  context.waitUntil(
    writeOperationAudit(request, identity.sub, "/admin/pipedrive/connect", "oauth.connect", "success", 302)
      .catch(() => undefined),
  );
  return Response.redirect(authorizationUrl, 302);
}

async function handlePipedriveCallback(
  request: Request,
  env: RemoteEnv,
  identity: AccessIdentity,
  context: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
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
    context.waitUntil(
      writeOperationAudit(request, identity.sub, "/oauth/pipedrive/callback", "oauth.callback", "error", 400)
        .catch(() => undefined),
    );
    return html("<h1>Connexion Pipedrive impossible</h1><p>Recommencez depuis la page d’administration.</p>", 400);
  }
  context.waitUntil(
    writeOperationAudit(request, identity.sub, "/oauth/pipedrive/callback", "oauth.callback", "success", 200)
      .catch(() => undefined),
  );
  return html("<h1>Pipedrive est connecté</h1><p>Le serveur peut maintenant renouveler l’accès automatiquement.</p>");
}

async function getTenantCredential(env: RemoteEnv): Promise<TenantCredential | undefined> {
  const response = await tenantSecretsStub(env).fetch("https://tenant.internal/credential");
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error("pipedrive_credential_unavailable");
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
  revision: number,
  changes: NonNullable<AuditEvent["policyChanges"]>,
): Promise<void> {
  await auditSink.write({
    v: 1,
    ts: new Date().toISOString(),
    requestId: requestId(request),
    actorId: await pseudonymizeAccessSub(sub),
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
  route: string,
  operation: string,
  outcome: "success" | "error",
  httpStatus: number,
): Promise<void> {
  await auditSink.write({
    v: 1,
    ts: new Date().toISOString(),
    requestId: requestId(request),
    actorId: await pseudonymizeAccessSub(sub),
    route,
    operation,
    effect: "oauth",
    outcome,
    httpStatus,
    latencyMs: 0,
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

function safeErrorCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[a-z0-9_:.-]{1,100}$/.test(error.message)
    ? error.message
    : fallback;
}
