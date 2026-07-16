import { normalizePipedriveApiDomain } from "./apiDomain.js";
import type { RemoteConfig, RemoteEnv } from "./env.js";
import {
  normalizeRemoteOAuthErrorCode,
  remoteOAuthErrorStatus,
} from "./oauthErrors.js";
import type { KeyValueStorage } from "./policy.js";

const MATERIAL_KEY = "oauth-material";
const STATE_KEY = "oauth-state";
const CONNECTION_KEY = "oauth-connection";
const ADMIN_ACTION_KEY = "oauth-admin-action";
const STATE_TTL_MS = 10 * 60_000;
const ADMIN_ACTION_TTL_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 60_000;
const TOKEN_ENDPOINT = "https://oauth.pipedrive.com/oauth/token";

type OAuthMaterial = {
  accessCredential: string;
  refreshCredential: string;
  expiresAtMs: number;
  apiDomain: string;
};

type EncryptedEnvelope = {
  v: 1;
  iv: string;
  ciphertext: string;
};

type StateRecord = {
  digest: string;
  adminSub: string;
  redirectUriHash: string;
  expiresAtMs: number;
  expectedGeneration?: number;
};

type ConnectionRecord = {
  generation: number;
  connectedAtMs?: number;
};

type AdminActionRecord = {
  digest: string;
  adminSub: string;
  expectedGeneration: number;
  expiresAtMs: number;
  action: "disconnect";
};

type PipedriveOAuthResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  api_domain?: unknown;
  error?: unknown;
};

export type TenantCredential = {
  accessCredential: string;
  apiDomain: string;
  expiresAtMs: number;
};

export type TenantConnectionStatus =
  | { connected: false }
  | { connected: true; materialReadable: false }
  | {
      connected: true;
      materialReadable: true;
      apiDomain: string;
      expiresAtMs: number;
      connectedAtMs?: number;
    };

export type TenantAdminView = {
  status: TenantConnectionStatus;
  actionToken: string;
};

export type TenantDisconnectResult = {
  disconnected: boolean;
};

type MaterialSnapshot = {
  envelope?: EncryptedEnvelope;
  material?: OAuthMaterial;
  connection: ConnectionRecord;
};

export class TenantSecretsCore {
  private readonly refreshInFlight = new Map<number, Promise<OAuthMaterial>>();
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly config: RemoteConfig,
    fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.fetcher = (input, init) => fetcher(input, init);
  }

  async createState(adminSub: string, redirectUri: string): Promise<string> {
    validateBounded(adminSub, 256, "oauth_state_invalid");
    validateRedirectUri(redirectUri);
    await assertEncryptionKeyUsable(this.config.encryptionKey);
    const state = randomBase64Url(32);
    const stateHash = await hash(state);
    const redirectUriHash = await hash(redirectUri);
    try {
      await this.storage.transaction(async (transaction) => {
        const connection = connectionRecord(
          await transaction.get<ConnectionRecord>(CONNECTION_KEY),
        );
        await transaction.put<StateRecord>(STATE_KEY, {
          digest: stateHash,
          adminSub,
          redirectUriHash,
          expiresAtMs: this.now() + STATE_TTL_MS,
          expectedGeneration: connection.generation,
        });
      });
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    return state;
  }

  async exchange(
    adminSub: string,
    state: string,
    code: string,
    redirectUri: string,
  ): Promise<TenantCredential> {
    validateBounded(adminSub, 256, "oauth_state_invalid");
    validateBounded(state, 256, "oauth_state_invalid");
    validateBounded(code, 4096, "oauth_code_invalid");
    validateRedirectUri(redirectUri);
    await assertEncryptionKeyUsable(this.config.encryptionKey);
    const expectedGeneration = await this.consumeState(adminSub, state, redirectUri);

    const parsed = await this.requestOAuth({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    const material = parseOAuthMaterial(parsed, this.now());
    const encrypted = await encryptMaterial(material, this.config.encryptionKey);
    let persisted = false;
    try {
      persisted = await this.storage.transaction(async (transaction) => {
        const current = connectionRecord(
          await transaction.get<ConnectionRecord>(CONNECTION_KEY),
        );
        if (current.generation !== expectedGeneration) {
          return false;
        }
        await transaction.put(MATERIAL_KEY, encrypted);
        await transaction.put<ConnectionRecord>(CONNECTION_KEY, {
          generation: current.generation + 1,
          connectedAtMs: this.now(),
        });
        return true;
      });
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    if (!persisted) {
      throw new Error("pipedrive_not_connected");
    }
    return publicCredential(material);
  }

  async discardState(adminSub: string, state: string, redirectUri: string): Promise<void> {
    validateBounded(adminSub, 256, "oauth_state_invalid");
    validateBounded(state, 256, "oauth_state_invalid");
    validateRedirectUri(redirectUri);
    await this.consumeState(adminSub, state, redirectUri);
  }

  private async consumeState(
    adminSub: string,
    state: string,
    redirectUri: string,
  ): Promise<number> {
    const stateHash = await hash(state);
    const redirectUriHash = await hash(redirectUri);
    let record: StateRecord | undefined;
    try {
      record = await this.storage.transaction(async (transaction) => {
        const current = await transaction.get<StateRecord>(STATE_KEY);
        await transaction.delete(STATE_KEY);
        return current;
      });
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    if (
      !record ||
      record.digest !== stateHash ||
      record.expiresAtMs <= this.now() ||
      record.adminSub !== adminSub ||
      record.redirectUriHash !== redirectUriHash
    ) {
      throw new Error("oauth_state_invalid");
    }
    return record.expectedGeneration ?? 0;
  }

  async getCredential(): Promise<TenantCredential> {
    const snapshot = await this.readSnapshot();
    if (!snapshot.material) {
      throw new Error("pipedrive_not_connected");
    }
    if (snapshot.material.expiresAtMs > this.now() + REFRESH_SKEW_MS) {
      return publicCredential(snapshot.material);
    }
    return publicCredential(await this.refresh(snapshot));
  }

  async getStatus(): Promise<TenantConnectionStatus> {
    return publicStatus(await this.readSnapshot());
  }

  async issueAdminView(adminSub: string): Promise<TenantAdminView> {
    validateBounded(adminSub, 256, "admin_csrf_invalid");
    const actionToken = randomBase64Url(32);
    const digest = await hash(actionToken);
    let snapshot: Omit<MaterialSnapshot, "material">;
    try {
      snapshot = await this.storage.transaction(async (transaction) => {
        const [envelope, storedConnection] = await Promise.all([
          transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
          transaction.get<ConnectionRecord>(CONNECTION_KEY),
        ]);
        const connection = connectionRecord(storedConnection);
        await transaction.put<AdminActionRecord>(ADMIN_ACTION_KEY, {
          digest,
          adminSub,
          expectedGeneration: connection.generation,
          expiresAtMs: this.now() + ADMIN_ACTION_TTL_MS,
          action: "disconnect",
        });
        return { envelope, connection };
      });
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    return {
      status: await publicStatusFromStored(snapshot, this.config.encryptionKey),
      actionToken,
    };
  }

  async disconnect(adminSub: string, actionToken: string): Promise<TenantDisconnectResult> {
    validateBounded(adminSub, 256, "admin_csrf_invalid");
    validateBounded(actionToken, 256, "admin_csrf_invalid");
    if (actionToken.length < 32) {
      throw new Error("admin_csrf_invalid");
    }
    const digest = await hash(actionToken);
    let outcome: { valid: boolean; disconnected: boolean };
    try {
      outcome = await this.storage.transaction(async (transaction) => {
        const [action, storedConnection, envelope] = await Promise.all([
          transaction.get<AdminActionRecord>(ADMIN_ACTION_KEY),
          transaction.get<ConnectionRecord>(CONNECTION_KEY),
          transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
        ]);
        await transaction.delete(ADMIN_ACTION_KEY);
        const connection = connectionRecord(storedConnection);
        if (
          !action ||
          action.digest !== digest ||
          action.adminSub !== adminSub ||
          action.action !== "disconnect" ||
          action.expiresAtMs <= this.now() ||
          action.expectedGeneration !== connection.generation
        ) {
          return { valid: false, disconnected: false };
        }
        await transaction.delete(MATERIAL_KEY);
        await transaction.delete(STATE_KEY);
        await transaction.put<ConnectionRecord>(CONNECTION_KEY, {
          generation: connection.generation + 1,
        });
        return { valid: true, disconnected: Boolean(envelope) };
      });
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    if (!outcome.valid) {
      throw new Error("admin_csrf_invalid");
    }
    return { disconnected: outcome.disconnected };
  }

  private async refresh(snapshot: MaterialSnapshot): Promise<OAuthMaterial> {
    const generation = snapshot.connection.generation;
    const existing = this.refreshInFlight.get(generation);
    if (existing) {
      return existing;
    }
    const promise = this.refreshOnce(snapshot).finally(() => {
      if (this.refreshInFlight.get(generation) === promise) {
        this.refreshInFlight.delete(generation);
      }
    });
    this.refreshInFlight.set(generation, promise);
    return promise;
  }

  private async refreshOnce(previous: MaterialSnapshot): Promise<OAuthMaterial> {
    const latest = await this.readSnapshot();
    if (
      !latest.material ||
      !latest.envelope ||
      latest.connection.generation !== previous.connection.generation
    ) {
      throw new Error("pipedrive_not_connected");
    }
    if (latest.material.expiresAtMs > this.now() + REFRESH_SKEW_MS) {
      return latest.material;
    }
    const parsed = await this.requestOAuth({
      grant_type: "refresh_token",
      refresh_token: latest.material.refreshCredential,
    });
    const updated = parseOAuthMaterial(parsed, this.now(), latest.material.refreshCredential);
    const encrypted = await encryptMaterial(updated, this.config.encryptionKey);
    let persisted = false;
    try {
      persisted = await this.storage.transaction(async (transaction) => {
        const [storedConnection, currentEnvelope] = await Promise.all([
          transaction.get<ConnectionRecord>(CONNECTION_KEY),
          transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
        ]);
        if (
          connectionRecord(storedConnection).generation !== latest.connection.generation ||
          !sameEnvelope(currentEnvelope, latest.envelope)
        ) {
          return false;
        }
        await transaction.put(MATERIAL_KEY, encrypted);
        return true;
      });
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    if (persisted) {
      return updated;
    }
    const current = await this.readSnapshot();
    if (
      current.material &&
      current.connection.generation === latest.connection.generation
    ) {
      return current.material;
    }
    throw new Error("pipedrive_not_connected");
  }

  private async requestOAuth(fields: Record<string, string>): Promise<PipedriveOAuthResponse> {
    const authorization = btoa(
      `${this.config.pipedriveClientId}:${this.config.pipedriveClientSecret}`,
    );
    let response: Response;
    try {
      response = await this.fetcher(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${authorization}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields),
      });
    } catch (error) {
      // Best-effort mapping of documented workerd wording; unknown TypeErrors stay generic.
      if (
        error instanceof TypeError &&
        /illegal invocation|incorrect this reference/i.test(error.message)
      ) {
        throw new Error("pipedrive_oauth_invocation_failed");
      }
      throw new Error("pipedrive_oauth_unavailable");
    }
    let parsed: PipedriveOAuthResponse;
    try {
      parsed = await response.json() as PipedriveOAuthResponse;
    } catch {
      throw new Error(response.ok ? "pipedrive_oauth_invalid_response" : "pipedrive_oauth_failed");
    }
    if (!response.ok) {
      if (parsed.error === "invalid_grant") {
        throw new Error("pipedrive_reconnect_required");
      }
      throw new Error("pipedrive_oauth_failed");
    }
    return parsed;
  }

  private async readSnapshot(): Promise<MaterialSnapshot> {
    let stored: Omit<MaterialSnapshot, "material">;
    try {
      stored = await this.storage.transaction(async (transaction) => {
        const [envelope, connection] = await Promise.all([
          transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
          transaction.get<ConnectionRecord>(CONNECTION_KEY),
        ]);
        return { envelope, connection: connectionRecord(connection) };
      });
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    return {
      ...stored,
      material: stored.envelope
        ? await decryptMaterial(stored.envelope, this.config.encryptionKey)
        : undefined,
    };
  }
}

export class TenantSecrets {
  private readonly core: TenantSecretsCore;

  constructor(state: DurableObjectState, env: RemoteEnv) {
    this.core = new TenantSecretsCore(
      state.storage as unknown as KeyValueStorage,
      {
        accessIssuer: "",
        accessAudience: "",
        adminEmail: "",
        pipedriveClientId: env.PIPEDRIVE_OAUTH_CLIENT_ID,
        pipedriveClientSecret: env.PIPEDRIVE_OAUTH_CLIENT_SECRET,
        encryptionKey: env.PIPEDRIVE_OAUTH_ENCRYPTION_KEY,
        auditHmacKey: env.AUDIT_HMAC_KEY,
      },
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/state") {
        const body = await requestJson<{ adminSub: string; redirectUri: string }>(request);
        return Response.json({
          state: await this.core.createState(body.adminSub, body.redirectUri),
        });
      }
      if (request.method === "POST" && url.pathname === "/exchange") {
        const body = await requestJson<{
          adminSub: string;
          state: string;
          code: string;
          redirectUri: string;
        }>(request);
        return Response.json(
          await this.core.exchange(body.adminSub, body.state, body.code, body.redirectUri),
        );
      }
      if (request.method === "POST" && url.pathname === "/state/discard") {
        const body = await requestJson<{
          adminSub: string;
          state: string;
          redirectUri: string;
        }>(request);
        await this.core.discardState(body.adminSub, body.state, body.redirectUri);
        return new Response(null, { status: 204 });
      }
      if (request.method === "GET" && url.pathname === "/credential") {
        return Response.json(await this.core.getCredential());
      }
      if (request.method === "POST" && url.pathname === "/admin-view") {
        const body = await requestJson<{ adminSub: string }>(request);
        return Response.json(await this.core.issueAdminView(body.adminSub));
      }
      if (request.method === "POST" && url.pathname === "/disconnect") {
        const body = await requestJson<{ adminSub: string; actionToken: string }>(request);
        return Response.json(await this.core.disconnect(body.adminSub, body.actionToken));
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      const code = normalizeRemoteOAuthErrorCode(
        error instanceof Error ? error.message : undefined,
      );
      const status = remoteOAuthErrorStatus(code);
      return Response.json({ code }, { status });
    }
  }
}

export function tenantSecretsStub(env: RemoteEnv): DurableObjectStub {
  return env.TENANT_SECRETS.get(env.TENANT_SECRETS.idFromName("tenant"));
}

export async function encryptMaterial(
  material: OAuthMaterial,
  encodedKey: string,
): Promise<EncryptedEnvelope> {
  const key = await importEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(material));
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode("pipedrive-oauth:v1") },
      key,
      plaintext,
    );
  } catch {
    throw new Error("oauth_encryption_failed");
  }
  return {
    v: 1,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptMaterial(
  envelope: EncryptedEnvelope,
  encodedKey: string,
): Promise<OAuthMaterial> {
  if (envelope.v !== 1) {
    throw new Error("oauth_material_invalid");
  }
  const key = await importEncryptionKey(encodedKey);
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(envelope.iv),
        additionalData: new TextEncoder().encode("pipedrive-oauth:v1"),
      },
      key,
      base64UrlToBytes(envelope.ciphertext),
    );
    return parseStoredMaterial(
      JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>,
    );
  } catch {
    throw new Error("oauth_material_invalid");
  }
}

function parseOAuthMaterial(
  parsed: PipedriveOAuthResponse,
  now: number,
  previousRefresh?: string,
): OAuthMaterial {
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof parsed.access_token !== "string" ||
    parsed.access_token.length === 0 ||
    (!previousRefresh && (typeof parsed.refresh_token !== "string" || parsed.refresh_token.length === 0)) ||
    !Number.isFinite(parsed.expires_in) ||
    (parsed.expires_in as number) <= 0
  ) {
    throw new Error("pipedrive_oauth_invalid_response");
  }
  const refreshCredential =
    typeof parsed.refresh_token === "string" && parsed.refresh_token.length > 0
      ? parsed.refresh_token
      : previousRefresh as string;
  return {
    accessCredential: parsed.access_token,
    refreshCredential,
    expiresAtMs: now + Math.floor(parsed.expires_in as number) * 1000,
    apiDomain: normalizePipedriveApiDomain(parsed.api_domain),
  };
}

function parseStoredMaterial(value: Record<string, unknown>): OAuthMaterial {
  if (
    typeof value.accessCredential !== "string" ||
    typeof value.refreshCredential !== "string" ||
    typeof value.expiresAtMs !== "number" ||
    typeof value.apiDomain !== "string"
  ) {
    throw new Error("oauth_material_invalid");
  }
  return {
    accessCredential: value.accessCredential,
    refreshCredential: value.refreshCredential,
    expiresAtMs: value.expiresAtMs,
    apiDomain: normalizePipedriveApiDomain(value.apiDomain),
  };
}

function publicCredential(material: OAuthMaterial): TenantCredential {
  return {
    accessCredential: material.accessCredential,
    apiDomain: material.apiDomain,
    expiresAtMs: material.expiresAtMs,
  };
}

async function publicStatus(snapshot: MaterialSnapshot): Promise<TenantConnectionStatus> {
  if (!snapshot.material) {
    return { connected: false };
  }
  return {
    connected: true,
    materialReadable: true,
    apiDomain: snapshot.material.apiDomain,
    expiresAtMs: snapshot.material.expiresAtMs,
    connectedAtMs: snapshot.connection.connectedAtMs,
  };
}

async function publicStatusFromStored(
  snapshot: Omit<MaterialSnapshot, "material">,
  encryptionKey: string,
): Promise<TenantConnectionStatus> {
  if (!snapshot.envelope) {
    return { connected: false };
  }
  try {
    return publicStatus({
      ...snapshot,
      material: await decryptMaterial(snapshot.envelope, encryptionKey),
    });
  } catch {
    // The admin kill switch must remain usable even if stored material cannot be decrypted.
    return { connected: true, materialReadable: false };
  }
}

function connectionRecord(value: ConnectionRecord | undefined): ConnectionRecord {
  if (!value) {
    return { generation: 0 };
  }
  if (
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0 ||
    (value.connectedAtMs !== undefined &&
      (!Number.isFinite(value.connectedAtMs) || value.connectedAtMs < 0))
  ) {
    throw new Error("oauth_material_invalid");
  }
  return value.connectedAtMs === undefined
    ? { generation: value.generation }
    : { generation: value.generation, connectedAtMs: value.connectedAtMs };
}

function sameEnvelope(
  left: EncryptedEnvelope | undefined,
  right: EncryptedEnvelope | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.v === right.v &&
    left.iv === right.iv &&
    left.ciphertext === right.ciphertext,
  );
}

async function importEncryptionKey(encodedKey: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(encodedKey);
  } catch {
    throw new Error("oauth_encryption_key_invalid");
  }
  if (bytes.byteLength !== 32) {
    throw new Error("oauth_encryption_key_invalid");
  }
  try {
    return await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    throw new Error("oauth_encryption_key_invalid");
  }
}

async function assertEncryptionKeyUsable(encodedKey: string): Promise<void> {
  await importEncryptionKey(encodedKey);
}

async function requestJson<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("tenant_request_invalid");
  }
}

function validateBounded(value: unknown, max: number, code: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(code);
  }
}

function validateRedirectUri(value: string): void {
  validateBounded(value, 2048, "oauth_redirect_invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("oauth_redirect_invalid");
  }
}

function randomBase64Url(length: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
