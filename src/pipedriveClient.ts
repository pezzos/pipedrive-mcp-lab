import { PipedriveConfig, requireConfigured } from "./config.js";

export type FetchLike = typeof fetch;

export class PipedriveClient {
  private readonly fetchImpl: FetchLike;
  private readonly config: PipedriveConfig;

  constructor(config: PipedriveConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
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

  async delete(path: string, params: Record<string, string | number | boolean | undefined> = {}) {
    return this.request("DELETE", path, params);
  }

  private async request(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    body?: unknown,
  ) {
    requireConfigured(this.config);
    const url = this.url(path, params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "x-api-token": this.config.apiToken ?? "",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        signal: controller.signal,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Pipedrive API ${method} ${path} timed out`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    const data = text ? safeJsonParse(text) : null;
    if (!response.ok) {
      throw new Error(
        `Pipedrive API ${method} ${path} failed with ${response.status}: ${summarizeError(data)}`,
      );
    }
    return data;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
