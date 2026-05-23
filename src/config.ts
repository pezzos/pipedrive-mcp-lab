export type PipedriveConfig = {
  apiToken?: string;
  companyDomain?: string;
  baseUrl: string;
  allowMockBaseUrl: boolean;
  enableWrites: boolean;
  writeConfirmation: string;
  requestTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PipedriveConfig {
  const companyDomain = clean(env.PIPEDRIVE_COMPANY_DOMAIN);
  const apiToken = clean(env.PIPEDRIVE_API_TOKEN);
  const baseUrl = clean(env.PIPEDRIVE_BASE_URL) ?? defaultBaseUrl(companyDomain);
  const allowMockBaseUrl = env.PIPEDRIVE_ALLOW_MOCK_BASE_URL === "true";
  const enableWrites = env.PIPEDRIVE_ENABLE_WRITES === "true";
  const writeConfirmation = clean(env.PIPEDRIVE_WRITE_CONFIRMATION) ?? "CONFIRM_WRITE";
  const requestTimeoutMs = Number(env.PIPEDRIVE_REQUEST_TIMEOUT_MS ?? 10_000);

  return {
    apiToken,
    companyDomain,
    baseUrl,
    allowMockBaseUrl,
    enableWrites,
    writeConfirmation,
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
