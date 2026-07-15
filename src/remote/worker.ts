import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleMcpRequest } from "./transport.js";

function createSmokeServer(): McpServer {
  const server = new McpServer({
    name: "pipedrive-mcp-remote",
    version: "0.1.7",
  });

  server.registerTool(
    "remote_transport_smoke",
    {
      description: "Verify that the remote MCP transport is responding.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text", text: "ok" }],
    }),
  );

  return server;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return Response.json({ status: "ok", transport: "streamable-http" });
    }

    if (url.pathname === "/mcp") {
      return handleMcpRequest(request, createSmokeServer);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
