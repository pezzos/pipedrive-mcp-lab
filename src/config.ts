export type PipedriveConfig = {
  apiToken?: string;
  companyDomain?: string;
  baseUrl: string;
  enableWrites: boolean;
  requestTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PipedriveConfig {
  const companyDomain = clean(env.PIPEDRIVE_COMPANY_DOMAIN);
  const apiToken = clean(env.PIPEDRIVE_API_TOKEN);
  const baseUrl = clean(env.PIPEDRIVE_BASE_URL) ?? defaultBaseUrl(companyDomain);
  const enableWrites = env.PIPEDRIVE_ENABLE_WRITES === "true";
  const requestTimeoutMs = Number(env.PIPEDRIVE_REQUEST_TIMEOUT_MS ?? 10_000);

  return {
    apiToken,
    companyDomain,
    baseUrl,
    enableWrites,
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 10_000,
  };
}

export function requireConfigured(config: PipedriveConfig): void {
  const missing = [];
  if (!config.apiToken) {
    missing.push("PIPEDRIVE_API_TOKEN");
  }
  if (!config.baseUrl) {
    missing.push("PIPEDRIVE_COMPANY_DOMAIN or PIPEDRIVE_BASE_URL");
  }
  if (missing.length > 0) {
    throw new Error(`Missing Pipedrive configuration: ${missing.join(", ")}`);
  }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function defaultBaseUrl(companyDomain?: string): string {
  if (!companyDomain) {
    return "";
  }
  return `https://${companyDomain}.pipedrive.com`;
}
