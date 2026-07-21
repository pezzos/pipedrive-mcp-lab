export type PipedriveConfig = {
  apiToken?: string;
  accessToken?: string;
  companyDomain?: string;
  baseUrl: string;
  baseUrlSource: "missing" | "company_domain" | "explicit";
  allowMockBaseUrl: boolean;
  enableWrites: boolean;
  enableDeleteTools: boolean;
  enableMailboxTools: boolean;
  requestTimeoutMs: number;
  operationSignal?: AbortSignal;
};

type Environment = Record<string, string | undefined>;

export function loadConfig(env: Environment = processEnvironment()): PipedriveConfig {
  const companyDomain = normalizeCompanyDomain(clean(env.PIPEDRIVE_COMPANY_DOMAIN));
  const apiToken = clean(env.PIPEDRIVE_API_TOKEN);
  const accessToken = clean(env.PIPEDRIVE_ACCESS_TOKEN);
  const explicitBaseUrl = normalizeBaseUrl(clean(env.PIPEDRIVE_BASE_URL));
  const baseUrl = explicitBaseUrl ?? defaultBaseUrl(companyDomain);
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
    baseUrlSource: explicitBaseUrl ? "explicit" : companyDomain ? "company_domain" : "missing",
    allowMockBaseUrl,
    enableWrites,
    enableDeleteTools,
    enableMailboxTools,
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 10_000,
  };
}

function processEnvironment(): Environment {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Environment };
    }
  ).process?.env ?? {};
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

function normalizeCompanyDomain(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const hostname = hostnameFromMaybeUrl(value);
  const normalized = stripPipedriveSuffix(hostname);
  return normalized && /^[a-z0-9-]+$/i.test(normalized) ? normalized : value;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.replace(/\/+$/, "");
  if (/^[a-z0-9-]+$/i.test(trimmed)) {
    return defaultBaseUrl(trimmed);
  }
  if (/^[a-z0-9-]+\.pipedrive\.com$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function defaultBaseUrl(companyDomain?: string): string {
  if (!companyDomain) {
    return "";
  }
  return `https://${companyDomain}.pipedrive.com`;
}

function hostnameFromMaybeUrl(value: string): string {
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

function stripPipedriveSuffix(value: string): string {
  return value.toLowerCase().endsWith(".pipedrive.com") ? value.slice(0, -".pipedrive.com".length) : value;
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
