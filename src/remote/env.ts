export interface RemoteEnv {
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  REMOTE_ADMIN_EMAIL: string;
  PIPEDRIVE_OAUTH_CLIENT_ID: string;
  PIPEDRIVE_OAUTH_CLIENT_SECRET: string;
  PIPEDRIVE_OAUTH_ENCRYPTION_KEY: string;
  AUDIT_HMAC_KEY: string;
  USER_POLICY: DurableObjectNamespace;
  TENANT_SECRETS: DurableObjectNamespace;
}

export type RemoteConfig = {
  accessIssuer: string;
  accessAudience: string;
  adminEmail: string;
  pipedriveClientId: string;
  pipedriveClientSecret: string;
  encryptionKey: string;
  auditHmacKey: string;
};

export function loadRemoteConfig(env: RemoteEnv): RemoteConfig {
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
    accessIssuer,
    accessAudience,
    adminEmail,
    pipedriveClientId,
    pipedriveClientSecret,
    encryptionKey,
    auditHmacKey,
  };
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
