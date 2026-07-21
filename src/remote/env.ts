export interface RemoteEnv {
  DEPLOY_ENVIRONMENT: string;
  PUBLIC_ORIGIN: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  REMOTE_ADMIN_EMAIL: string;
  REMOTE_ADMIN_SUB: string;
  PIPEDRIVE_OAUTH_CLIENT_ID: string;
  PIPEDRIVE_OAUTH_CLIENT_SECRET: string;
  PIPEDRIVE_OAUTH_ENCRYPTION_KEY: string;
  AUDIT_HMAC_KEY: string;
  PIPEDRIVE_OAUTH_CLIENT_EPOCH: string;
  PIPEDRIVE_OAUTH_ENCRYPTION_KID: string;
  AUDIT_HMAC_EPOCH: string;
  PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID?: string;
  PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY?: string;
  AUDIT_HMAC_PREVIOUS_EPOCH?: string;
  AUDIT_HMAC_PREVIOUS_KEY?: string;
  AUDIT_HMAC_PREVIOUS_VALID_UNTIL?: string;
  ACCESS_PREVIOUS_ISSUER?: string;
  ACCESS_PREVIOUS_AUD?: string;
  ACCESS_PREVIOUS_VALID_UNTIL?: string;
  USER_POLICY: DurableObjectNamespace;
  USER_CONNECTION: DurableObjectNamespace;
  TENANT_REGISTRY: DurableObjectNamespace;
}

export type RemoteConfig = {
  deployEnvironment: "sandbox" | "production";
  publicOrigin: string;
  oauthCallbackUrl: string;
  accessIssuer: string;
  accessAudience: string;
  adminEmail: string;
  adminSub: string;
  pipedriveClientId: string;
  pipedriveClientSecret: string;
  encryptionKey: string;
  encryptionKid: string;
  oauthClientEpoch: string;
  auditHmacKey: string;
  auditHmacEpoch: string;
  oldEncryption?: { kid: string; key: string };
  previousAudit?: { epoch: string; key: string; validUntilMs: number };
  previousAccess?: { issuer: string; audience: string; validUntilMs: number };
};

export type RemoteStateConfig = Pick<
  RemoteConfig,
  | "deployEnvironment"
  | "publicOrigin"
  | "oauthCallbackUrl"
  | "pipedriveClientId"
  | "pipedriveClientSecret"
  | "encryptionKey"
  | "encryptionKid"
  | "oauthClientEpoch"
  | "oldEncryption"
>;

export function loadRemoteConfig(env: RemoteEnv): RemoteConfig {
  const deployEnvironment = deploymentEnvironment(env.DEPLOY_ENVIRONMENT);
  const configuredPublicOrigin = publicOrigin(env.PUBLIC_ORIGIN);
  const accessIssuer = required(env.ACCESS_ISSUER, "ACCESS_ISSUER");
  const accessAudience = required(env.ACCESS_AUD, "ACCESS_AUD");
  const adminEmail = normalizeAdminEmail(env.REMOTE_ADMIN_EMAIL);
  const adminSub = safeIdentifier(env.REMOTE_ADMIN_SUB, "REMOTE_ADMIN_SUB");
  const pipedriveClientId = required(
    env.PIPEDRIVE_OAUTH_CLIENT_ID,
    "PIPEDRIVE_OAUTH_CLIENT_ID",
  );
  const pipedriveClientSecret = required(
    env.PIPEDRIVE_OAUTH_CLIENT_SECRET,
    "PIPEDRIVE_OAUTH_CLIENT_SECRET",
  );
  const encryptionKey = encryptionKeyValue(
    env.PIPEDRIVE_OAUTH_ENCRYPTION_KEY,
    "PIPEDRIVE_OAUTH_ENCRYPTION_KEY",
  );
  const auditHmacKey = encryptionKeyValue(env.AUDIT_HMAC_KEY, "AUDIT_HMAC_KEY");
  const encryptionKid = safeIdentifier(env.PIPEDRIVE_OAUTH_ENCRYPTION_KID, "PIPEDRIVE_OAUTH_ENCRYPTION_KID");
  const oauthClientEpoch = quarterEpoch(env.PIPEDRIVE_OAUTH_CLIENT_EPOCH, "PIPEDRIVE_OAUTH_CLIENT_EPOCH");
  const auditHmacEpoch = quarterEpoch(env.AUDIT_HMAC_EPOCH, "AUDIT_HMAC_EPOCH");
  const oldEncryption = optionalPair(env.PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID, env.PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY, "PIPEDRIVE_OAUTH_OLD_ENCRYPTION");
  if (oldEncryption && oldEncryption[0] === encryptionKid) throw new Error("remote_configuration_invalid:PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID");
  const previousAudit = optionalTriple(env.AUDIT_HMAC_PREVIOUS_EPOCH, env.AUDIT_HMAC_PREVIOUS_KEY, env.AUDIT_HMAC_PREVIOUS_VALID_UNTIL, "AUDIT_HMAC_PREVIOUS");
  if (previousAudit && quarterEpoch(previousAudit[0], "AUDIT_HMAC_PREVIOUS_EPOCH") === auditHmacEpoch) throw new Error("remote_configuration_invalid:AUDIT_HMAC_PREVIOUS_EPOCH");
  const previousAccess = optionalAccessPair(env);
  if (oldEncryption && keyMaterialEqual(encryptionKey, encryptionKeyValue(oldEncryption[1], "PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY"))) throw new Error("remote_configuration_invalid:PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY");
  if (previousAudit && keyMaterialEqual(auditHmacKey, encryptionKeyValue(previousAudit[1], "AUDIT_HMAC_PREVIOUS_KEY"))) throw new Error("remote_configuration_invalid:AUDIT_HMAC_PREVIOUS_KEY");
  for (const encryption of [encryptionKey, ...(oldEncryption ? [oldEncryption[1]] : [])]) if ([auditHmacKey, ...(previousAudit ? [previousAudit[1]] : [])].some((audit) => keyMaterialEqual(encryption, audit))) throw new Error("remote_configuration_invalid:key_material_independent");

  return {
    deployEnvironment,
    publicOrigin: configuredPublicOrigin,
    oauthCallbackUrl: new URL("/oauth/pipedrive/callback", configuredPublicOrigin).toString(),
    accessIssuer,
    accessAudience,
    adminEmail,
    adminSub,
    pipedriveClientId,
    pipedriveClientSecret,
    encryptionKey,
    encryptionKid,
    oauthClientEpoch,
    auditHmacKey,
    auditHmacEpoch,
    ...(oldEncryption ? { oldEncryption: { kid: safeIdentifier(oldEncryption[0], "PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID"), key: encryptionKeyValue(oldEncryption[1], "PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY") } } : {}),
    ...(previousAudit ? { previousAudit: { epoch: quarterEpoch(previousAudit[0], "AUDIT_HMAC_PREVIOUS_EPOCH"), key: encryptionKeyValue(previousAudit[1], "AUDIT_HMAC_PREVIOUS_KEY"), validUntilMs: cutoff(previousAudit[2], "AUDIT_HMAC_PREVIOUS_VALID_UNTIL") } } : {}),
    ...(previousAccess ? { previousAccess } : {}),
  };
}

/** Validates the deployment identity and the only secret material state objects use. */
export function loadRemoteStateConfig(env: RemoteEnv): RemoteStateConfig {
  const deployEnvironment = deploymentEnvironment(env.DEPLOY_ENVIRONMENT);
  const configuredPublicOrigin = publicOrigin(env.PUBLIC_ORIGIN);
  const oldPair = optionalPair(env.PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID, env.PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY, "PIPEDRIVE_OAUTH_OLD_ENCRYPTION");
  const primary = encryptionKeyValue(env.PIPEDRIVE_OAUTH_ENCRYPTION_KEY, "PIPEDRIVE_OAUTH_ENCRYPTION_KEY");
  if (oldPair && keyMaterialEqual(primary, encryptionKeyValue(oldPair[1], "PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY"))) throw new Error("remote_configuration_invalid:PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY");
  return {
    deployEnvironment,
    publicOrigin: configuredPublicOrigin,
    oauthCallbackUrl: new URL("/oauth/pipedrive/callback", configuredPublicOrigin).toString(),
    pipedriveClientId: required(env.PIPEDRIVE_OAUTH_CLIENT_ID, "PIPEDRIVE_OAUTH_CLIENT_ID"),
    pipedriveClientSecret: required(env.PIPEDRIVE_OAUTH_CLIENT_SECRET, "PIPEDRIVE_OAUTH_CLIENT_SECRET"),
    encryptionKey: primary,
    encryptionKid: safeIdentifier(env.PIPEDRIVE_OAUTH_ENCRYPTION_KID, "PIPEDRIVE_OAUTH_ENCRYPTION_KID"),
    oauthClientEpoch: quarterEpoch(env.PIPEDRIVE_OAUTH_CLIENT_EPOCH, "PIPEDRIVE_OAUTH_CLIENT_EPOCH"),
    ...(oldPair ? { oldEncryption: { kid: safeIdentifier(oldPair[0], "PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID"), key: encryptionKeyValue(oldPair[1], "PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY") } } : {}),
  };
}

export function deploymentEnvironment(value: unknown): "sandbox" | "production" {
  if (value === "sandbox" || value === "production") return value;
  throw new Error("remote_configuration_invalid:DEPLOY_ENVIRONMENT");
}

export function publicOrigin(value: unknown): string {
  const configured = required(value, "PUBLIC_ORIGIN");
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("remote_configuration_invalid:PUBLIC_ORIGIN"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("remote_configuration_invalid:PUBLIC_ORIGIN");
  }
  return url.origin;
}

export function requestUsesConfiguredOrigin(request: Request, config: Pick<RemoteConfig, "publicOrigin">): boolean {
  return new URL(request.url).origin === config.publicOrigin;
}

export function normalizeAdminEmail(value: unknown): string {
  const email = required(value, "REMOTE_ADMIN_EMAIL").toLowerCase();
  if (email.length > 320 || !email.includes("@")) {
    throw new Error("remote_configuration_invalid:REMOTE_ADMIN_EMAIL");
  }
  return email;
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`remote_configuration_missing:${name}`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 4096) {
    throw new Error(`remote_configuration_missing:${name}`);
  }
  return normalized;
}

function safeIdentifier(value: unknown, name: string): string {
  const normalized = required(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(normalized)) throw new Error(`remote_configuration_invalid:${name}`);
  return normalized;
}

function quarterEpoch(value: unknown, name: string): string {
  return safeIdentifier(value, name);
}

function encryptionKeyValue(value: unknown, name: string): string {
  const key = required(value, name);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(key)) throw new Error(`remote_configuration_invalid:${name}`);
  try { const bytes = base64UrlBytes(key); if (bytes.length !== 32 || base64Url(bytes) !== key) throw new Error(); } catch { throw new Error(`remote_configuration_invalid:${name}`); }
  return key;
}
function keyMaterialEqual(left: string, right: string): boolean { const a = base64UrlBytes(left); const b = base64UrlBytes(right); return a.length === b.length && a.every((value, index) => value === b[index]); }
function base64UrlBytes(value: string): Uint8Array { return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "="), (c) => c.charCodeAt(0)); }
function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }

function optionalAccessPair(env: RemoteEnv): RemoteConfig["previousAccess"] {
  const pair = optionalPair(env.ACCESS_PREVIOUS_ISSUER, env.ACCESS_PREVIOUS_AUD, "ACCESS_PREVIOUS");
  const until = env.ACCESS_PREVIOUS_VALID_UNTIL;
  if (!pair && (until === undefined || until === "")) return undefined;
  if (!pair || typeof until !== "string") throw new Error("remote_configuration_invalid:ACCESS_PREVIOUS");
  return { issuer: publicOrigin(pair[0]), audience: boundedAudience(pair[1], "ACCESS_PREVIOUS_AUD"), validUntilMs: exactIsoCutoff(until, "ACCESS_PREVIOUS_VALID_UNTIL", false) };
}
function optionalTriple(a: unknown, b: unknown, c: unknown, name: string): [string, string, string] | undefined {
  if ((a === undefined || a === "") && (b === undefined || b === "") && (c === undefined || c === "")) return undefined;
  if (typeof a !== "string" || typeof b !== "string" || typeof c !== "string" || !a || !b || !c || a !== a.trim() || b !== b.trim() || c !== c.trim() || /[\r\n]/.test(`${a}${b}${c}`)) throw new Error(`remote_configuration_invalid:${name}`);
  return [a, b, c];
}
function optionalPair(left: unknown, right: unknown, name: string): [string, string] | undefined {
  if ((left === undefined || left === "") && (right === undefined || right === "")) return undefined;
  if (typeof left !== "string" || typeof right !== "string" || !left || !right || left !== left.trim() || right !== right.trim() || /[\r\n]/.test(`${left}${right}`)) throw new Error(`remote_configuration_invalid:${name}`);
  return [left, right];
}
function boundedAudience(value: string, name: string): string { if (value.length > 256 || !value.trim() || /[\r\n]/.test(value)) throw new Error(`remote_configuration_invalid:${name}`); return value; }
function exactIsoCutoff(value: string, name: string, maximum90Days: boolean): number { const time = Date.parse(value); if (!Number.isFinite(time) || new Date(time).toISOString() !== value || (maximum90Days && time > Date.now() + 90 * 24 * 60 * 60_000)) throw new Error(`remote_configuration_invalid:${name}`); return time; }
function cutoff(value: string, name: string): number { return exactIsoCutoff(value, name, true); }
