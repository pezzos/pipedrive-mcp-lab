import { PipedriveConfig, requireConfigured } from "./config.js";
import { boundedText } from "./boundedBody.js";

export type FetchLike = typeof fetch;
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

export class PipedriveApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: "pipedrive_rate_limited",
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "PipedriveApiError";
  }
}

export class PipedriveClient {
  private readonly fetchImpl: FetchLike;
  private readonly config: PipedriveConfig;

  constructor(config: PipedriveConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  async get(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
    return this.request("GET", path, params);
  }

  async post(
    path: string,
    body: unknown,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    return this.request("POST", path, params, body);
  }

  async patch(
    path: string,
    body: unknown,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    return this.request("PATCH", path, params, body);
  }

  async put(
    path: string,
    body: unknown,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    return this.request("PUT", path, params, body);
  }

  async putForm(
    path: string,
    body: Record<string, string | number | boolean | undefined>,
    params: Record<string, string | number | boolean | undefined> = {},
  ) {
    return this.request("PUT", path, params, body, "form");
  }

  async delete(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
    return this.request("DELETE", path, params);
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    body?: unknown,
    bodyFormat: "json" | "form" = "json",
  ) {
    requireConfigured(this.config);
    const url = this.url(path, params);
    const encodedBody = body === undefined ? undefined : encodeBody(body, bodyFormat);
    const maxAttempts = method === "GET" ? 3 : 1;
    let remainingRetryDelayMs = 5000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (this.config.operationSignal?.aborted) throw new Error("pipedrive_operation_deadline_exceeded");
      const controller = new AbortController();
      const abortOperation = () => controller.abort();
      this.config.operationSignal?.addEventListener("abort", abortOperation, { once: true });
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      let response: Response;
      let text: string;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            ...authHeaders(this.config),
            ...(encodedBody ? { "content-type": contentType(bodyFormat) } : {}),
          },
          signal: controller.signal,
          body: encodedBody,
        });
        text = await boundedProviderText(response);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(this.config.operationSignal?.aborted ? "pipedrive_operation_deadline_exceeded" : `Pipedrive API ${method} ${path} timed out`);
        }
        if (method === "GET" && attempt < maxAttempts) {
          const retryDelay = defaultRetryDelayMs(attempt);
          remainingRetryDelayMs -= retryDelay;
          await sleep(retryDelay, this.config.operationSignal);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        this.config.operationSignal?.removeEventListener("abort", abortOperation);
      }

      const data = text ? safeJsonParse(text) : null;
      if (!response.ok) {
        if (method === "GET" && attempt < maxAttempts && isTransientStatus(response.status)) {
          const retryDelay = retryDelayMs(response.headers.get("retry-after"), attempt);
          if (retryDelay !== undefined && retryDelay <= remainingRetryDelayMs) {
            remainingRetryDelayMs -= retryDelay;
            await sleep(retryDelay, this.config.operationSignal);
            continue;
          }
        }
        if (response.status === 429) {
          throw new PipedriveApiError(429, "pipedrive_rate_limited:429", "pipedrive_rate_limited", boundedRetryAfterSeconds(response.headers.get("retry-after")));
        }
        throw new PipedriveApiError(response.status, redactSecretMarkers(`Pipedrive API ${method} ${path} failed with ${response.status}: ${summarizeError(data)}`));
      }
      return data;
    }

    throw new Error(`Pipedrive API ${method} ${path} failed after ${maxAttempts} attempts`);
  }

  private url(path: string, params: Record<string, string | number | boolean | undefined>) {
    const base = this.config.baseUrl.replace(/\/$/, "");
    const url = new URL(path, `${base}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }
}

function boundedRetryAfterSeconds(value: string | null): number {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 60 ? seconds : 1;
}

async function boundedProviderText(response: Response): Promise<string> {
  try { return await boundedText(response, MAX_PROVIDER_RESPONSE_BYTES); } catch (error) { if (error instanceof Error && error.message === "body_too_large") throw new Error("pipedrive_response_too_large"); throw error; }
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(retryAfter: string | null | undefined, attempt: number): number | undefined {
  const maximumServerDelayMs = 5000;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const delay = seconds * 1000;
      return delay <= maximumServerDelayMs ? delay : undefined;
    }
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      const delay = Math.max(timestamp - Date.now(), 0);
      return delay <= maximumServerDelayMs ? delay : undefined;
    }
  }
  return defaultRetryDelayMs(attempt);
}

function defaultRetryDelayMs(attempt: number): number {
  return Math.min(50 * 2 ** (attempt - 1), 200);
}

function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new Error("pipedrive_operation_deadline_exceeded"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new Error("pipedrive_operation_deadline_exceeded")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function authHeaders(config: PipedriveConfig): Record<string, string> {
  if (config.accessToken) {
    return { Authorization: `Bearer ${config.accessToken}` };
  }
  return { "x-api-token": config.apiToken ?? "" };
}

function contentType(format: "json" | "form") {
  return format === "form" ? "application/x-www-form-urlencoded" : "application/json";
}

function encodeBody(body: unknown, format: "json" | "form") {
  if (format === "json") {
    return JSON.stringify(body);
  }
  if (!isRecord(body)) {
    throw new Error("Form-encoded Pipedrive API requests require an object body");
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

function summarizeError(data: unknown): string {
  if (isRecord(data) && typeof data.error === "string") {
    return data.error;
  }
  if (isRecord(data) && typeof data.error_info === "string") {
    return data.error_info;
  }
  return "request failed";
}

function redactSecretMarkers(value: string): string {
  return value
    .replace(/authorization:\s*bearer\s+\S+/gi, "Authorization: Bearer [redacted]")
    .replace(/x-api-token:\s*\S+/gi, "x-api-token: [redacted]")
    .replace(
      /(["']?(?:access_token|refresh_token|api_token|apiKey|api_key|secret|password)["']?\s*[:=]\s*["']?)([^"',\s}&]+)/gi,
      "$1[redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer [redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
