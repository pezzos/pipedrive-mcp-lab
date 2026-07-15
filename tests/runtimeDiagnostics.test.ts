import assert from "node:assert/strict";
import test from "node:test";

import { PipedriveClient } from "../src/pipedriveClient.js";
import { buildServer } from "../src/tools.js";
import { loadConfig } from "../src/config.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("buildServer uses injected runtime diagnostics without importing the Node loader", async () => {
  const config = loadConfig({
    PIPEDRIVE_API_TOKEN: "test-token",
    PIPEDRIVE_COMPANY_DOMAIN: "test",
  });
  const server = buildServer(config, new PipedriveClient(config), {
    runtimeEnvDiagnostics: () => ({
      initialized: true,
      dotenvLoadingEnabled: false,
      dotenvLocalFilePresent: false,
      dotenvLoaded: false,
      dotenvLoadFailed: false,
      preexisting: {
        enableWrites: true,
        enableDeleteTools: false,
        enableMailboxTools: true,
        loadDotenv: false,
      },
      current: {
        enableWrites: true,
        enableDeleteTools: false,
        enableMailboxTools: true,
        loadDotenv: false,
      },
    }),
  });
  const client = new Client({ name: "runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = await client.callTool({
      name: "pipedrive_health_check",
      arguments: {},
    });
    const payload = JSON.parse(
      (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}",
    ) as Record<string, unknown>;
    assert.equal(payload.runtime_env_diagnostics_initialized, true);
    assert.equal(payload.runtime_env_preexisting_enable_writes, true);
    assert.equal(payload.runtime_env_current_has_enable_mailbox_tools, true);
  } finally {
    await client.close();
    await server.close();
  }
});
