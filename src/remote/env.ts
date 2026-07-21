export interface RemoteEnv {
  DEPLOY_ENVIRONMENT: string;
  PUBLIC_ORIGIN: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  REMOTE_ADMIN_EMAIL: string;
  PIPEDRIVE_OAUTH_CLIENT_ID: string;
  PIPEDRIVE_OAUTH_CLIENT_SECRET: string;
  PIPEDRIVE_OAUTH_ENCRYPTION_KEY: string;
  AUDIT_HMAC_KEY: string;
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
  pipedriveClientId: string;
  pipedriveClientSecret: string;
  encryptionKey: string;
  auditHmacKey: string;
};

export type RemoteStateConfig = Pick<
  RemoteConfig,
  | "deployEnvironment"
  | "publicOrigin"
  | "oauthCallbackUrl"
  | "pipedriveClientId"
  | "pipedriveClientSecret"
  | "encryptionKey"
>;

export function loadRemoteConfig(env: RemoteEnv): RemoteConfig {
  const deployEnvironment = deploymentEnvironment(env.DEPLOY_ENVIRONMENT);
  const configuredPublicOrigin = publicOrigin(env.PUBLIC_ORIGIN);
  const accessIssuer = required(env.ACCESS_ISSUER, "ACCESS_ISSUER");
  const accessAudience = required(env.ACCESS_AUD, "ACCESS_AUD");
  const adminEmail = normalizeAdminEmail(env.REMOTE_ADMIN_EMAIL);
  const pipedriveClientId = required(
    env.PIPEDRIVE_OAUTH_CLIENT_ID,
    "PIPEDRIVE_OAUTH_CLIENT_ID",
  );
  const pipedriveClientSecret = required(
    env.PIPEDRIVE_OAUTH_CLIENT_SECRET,
    "PIPEDRIVE_OAUTH_CLIENT_SECRET",
  );
  const encryptionKey = required(
    env.PIPEDRIVE_OAUTH_ENCRYPTION_KEY,
    "PIPEDRIVE_OAUTH_ENCRYPTION_KEY",
  );
  const auditHmacKey = required(env.AUDIT_HMAC_KEY, "AUDIT_HMAC_KEY");

  return {
    deployEnvironment,
    publicOrigin: configuredPublicOrigin,
    oauthCallbackUrl: new URL("/oauth/pipedrive/callback", configuredPublicOrigin).toString(),
    accessIssuer,
    accessAudience,
    adminEmail,
    pipedriveClientId,
    pipedriveClientSecret,
    encryptionKey,
    auditHmacKey,
  };
}

/** Validates the deployment identity and the only secret material state objects use. */
export function loadRemoteStateConfig(env: RemoteEnv): RemoteStateConfig {
  const deployEnvironment = deploymentEnvironment(env.DEPLOY_ENVIRONMENT);
  const configuredPublicOrigin = publicOrigin(env.PUBLIC_ORIGIN);
  return {
    deployEnvironment,
    publicOrigin: configuredPublicOrigin,
    oauthCallbackUrl: new URL("/oauth/pipedrive/callback", configuredPublicOrigin).toString(),
    pipedriveClientId: required(env.PIPEDRIVE_OAUTH_CLIENT_ID, "PIPEDRIVE_OAUTH_CLIENT_ID"),
    pipedriveClientSecret: required(env.PIPEDRIVE_OAUTH_CLIENT_SECRET, "PIPEDRIVE_OAUTH_CLIENT_SECRET"),
    encryptionKey: required(env.PIPEDRIVE_OAUTH_ENCRYPTION_KEY, "PIPEDRIVE_OAUTH_ENCRYPTION_KEY"),
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
