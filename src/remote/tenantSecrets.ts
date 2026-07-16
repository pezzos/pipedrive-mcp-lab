import { normalizePipedriveApiDomain } from "./apiDomain.js";
import type { RemoteConfig, RemoteEnv } from "./env.js";
import {
  normalizeRemoteOAuthErrorCode,
  remoteOAuthErrorStatus,
} from "./oauthErrors.js";
import type { KeyValueStorage } from "./policy.js";

const MATERIAL_KEY = "oauth-material";
const STATE_KEY = "oauth-state";
const STATE_TTL_MS = 10 * 60_000;
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

export class TenantSecretsCore {
  private refreshInFlight: Promise<OAuthMaterial> | undefined;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly config: RemoteConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async createState(adminSub: string, redirectUri: string): Promise<string> {
    validateBounded(adminSub, 256, "oauth_state_invalid");
    validateRedirectUri(redirectUri);
    await assertEncryptionKeyUsable(this.config.encryptionKey);
    const state = randomBase64Url(32);
    const stateHash = await hash(state);
    try {
      await this.storage.put<StateRecord>(STATE_KEY, {
        digest: stateHash,
        adminSub,
        redirectUriHash: await hash(redirectUri),
        expiresAtMs: this.now() + STATE_TTL_MS,
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
    await this.consumeState(adminSub, state, redirectUri);

    const parsed = await this.requestOAuth({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    const material = parseOAuthMaterial(parsed, this.now());
    await this.persist(material);
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
  ): Promise<void> {
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
  }

  async getCredential(): Promise<TenantCredential> {
    const material = await this.read();
    if (!material) {
      throw new Error("pipedrive_not_connected");
    }
    if (material.expiresAtMs > this.now() + REFRESH_SKEW_MS) {
      return publicCredential(material);
    }
    return publicCredential(await this.refresh(material));
  }

  private async refresh(previous: OAuthMaterial): Promise<OAuthMaterial> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshOnce(previous).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private async refreshOnce(previous: OAuthMaterial): Promise<OAuthMaterial> {
    const latest = await this.read();
    if (!latest) {
      throw new Error("pipedrive_not_connected");
    }
    if (latest.expiresAtMs > this.now() + REFRESH_SKEW_MS) {
      return latest;
    }
    const parsed = await this.requestOAuth({
      grant_type: "refresh_token",
      refresh_token: latest.refreshCredential,
    });
    const updated = parseOAuthMaterial(parsed, this.now(), latest.refreshCredential);
    await this.persist(updated);
    return updated;
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
    } catch {
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

  private async read(): Promise<OAuthMaterial | undefined> {
    let envelope: EncryptedEnvelope | undefined;
    try {
      envelope = await this.storage.get<EncryptedEnvelope>(MATERIAL_KEY);
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
    if (!envelope) {
      return undefined;
    }
    return decryptMaterial(envelope, this.config.encryptionKey);
  }

  private async persist(material: OAuthMaterial): Promise<void> {
    const encrypted = await encryptMaterial(material, this.config.encryptionKey);
    try {
      await this.storage.put(MATERIAL_KEY, encrypted);
    } catch {
      throw new Error("tenant_storage_unavailable");
    }
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
