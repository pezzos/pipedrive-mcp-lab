import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { boundedBody } from "../boundedBody.js";

export type ServerFactory = () => McpServer;

export async function preflightMcpRequest(request: Request): Promise<{ request: Request } | { response: Response }> {
  if (request.method !== "POST") return { request };
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > 64 * 1024) return { response: mcpError("remote_request_too_large", 413) };
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return { response: mcpError("remote_content_type_invalid", 415) };
  let body: Uint8Array; try { body = await boundedBody(request, 64 * 1024); } catch { return { response: mcpError("remote_request_too_large", 413) }; }
  try { JSON.parse(new TextDecoder().decode(body)); } catch { return { response: mcpError("remote_request_invalid", 400) }; }
  const headers = new Headers(request.headers); headers.set("x-pipedrive-mcp-preflight", "1");
  return { request: new Request(request, { body: body.buffer as ArrayBuffer, headers }) };
}

export async function handleMcpRequest(
  request: Request,
  createServer: ServerFactory,
): Promise<Response> {
  if (request.method === "POST" && request.headers.get("x-pipedrive-mcp-preflight") !== "1") {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(length) || length > 64 * 1024) return mcpError("remote_request_too_large", 413);
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return mcpError("remote_content_type_invalid", 415);
    // Read once for a bounded preflight and reconstruct the request for the SDK.
    let body: Uint8Array; try { body = await boundedBody(request, 64 * 1024); } catch { return mcpError("remote_request_too_large", 413); }
    try { JSON.parse(new TextDecoder().decode(body)); } catch { return mcpError("remote_request_invalid", 400); }
    request = new Request(request, { body: body.buffer as ArrayBuffer });
  }
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

function mcpError(code: string, status: number): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: -32600, message: code }, id: null }, { status, headers: { "cache-control": "no-store", "content-type": "application/json" } });
}
