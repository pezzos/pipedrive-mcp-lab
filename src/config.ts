export type PipedriveConfig = {
  apiToken?: string;
  accessToken?: string;
  companyDomain?: string;
  baseUrl: string;
  allowMockBaseUrl: boolean;
  enableWrites: boolean;
  enableDeleteTools: boolean;
  enableMailboxTools: boolean;
  requestTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PipedriveConfig {
  const companyDomain = clean(env.PIPEDRIVE_COMPANY_DOMAIN);
  const apiToken = clean(env.PIPEDRIVE_API_TOKEN);
  const accessToken = clean(env.PIPEDRIVE_ACCESS_TOKEN);
  const baseUrl = clean(env.PIPEDRIVE_BASE_URL) ?? defaultBaseUrl(companyDomain);
  const allowMockBaseUrl = env.PIPEDRIVE_ALLOW_MOCK_BASE_URL === "true";
  const enableWrites = env.PIPEDRIVE_ENABLE_WRITES === "true";
  const enableDeleteTools = env.PIPEDRIVE_ENABLE_DELETE_TOOLS === "true";
  const enableMailboxTools = env.PIPEDRIVE_ENABLE_MAILBOX_TOOLS === "true";
  const requestTimeoutMs = Number(env.PIPEDRIVE_REQUEST_TIMEOUT_MS ?? 10_000);

  return {
    apiToken,
    accessToken,
    companyDomain,
    baseUrl,
    allowMockBaseUrl,
    enableWrites,
    enableDeleteTools,
    enableMailboxTools,
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 10_000,
  };
}

export function requireConfigured(config: PipedriveConfig): void {
  const missing = [];
  if (!config.apiToken && !config.accessToken) {
    missing.push("PIPEDRIVE_API_TOKEN or PIPEDRIVE_ACCESS_TOKEN");
  }
  if (!config.baseUrl) {
    missing.push("PIPEDRIVE_COMPANY_DOMAIN or PIPEDRIVE_BASE_URL");
  }
  if (missing.length > 0) {
    throw new Error(`Missing Pipedrive configuration: ${missing.join(", ")}`);
  }
  if (!isAllowedBaseUrl(config.baseUrl, config.allowMockBaseUrl)) {
    throw new Error(
      "Invalid Pipedrive configuration: PIPEDRIVE_BASE_URL must be https://*.pipedrive.com, or a loopback URL when PIPEDRIVE_ALLOW_MOCK_BASE_URL=true",
    );
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

function isAllowedBaseUrl(baseUrl: string, allowMockBaseUrl: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }
  if (isPipedriveBaseUrl(parsed)) {
    return true;
  }
  return allowMockBaseUrl && isLoopbackBaseUrl(parsed);
}

function isPipedriveBaseUrl(parsed: URL): boolean {
  return parsed.protocol === "https:" && parsed.hostname.toLowerCase().endsWith(".pipedrive.com");
}

function isLoopbackBaseUrl(parsed: URL): boolean {
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && ["localhost", "127.0.0.1", "::1"].includes(hostname);
}
