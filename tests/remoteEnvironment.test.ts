import assert from "node:assert/strict";
import test from "node:test";

import { deploymentEnvironment, loadRemoteConfig, publicOrigin, requestUsesConfiguredOrigin } from "../src/remote/env.js";

test("remote environment derives the callback only from a validated public origin", () => {
  const config = loadRemoteConfig({
    DEPLOY_ENVIRONMENT: "sandbox", PUBLIC_ORIGIN: "https://mcp.example.test",
    ACCESS_ISSUER: "https://access.example.test", ACCESS_AUD: "aud", REMOTE_ADMIN_EMAIL: "admin@example.test",
    PIPEDRIVE_OAUTH_CLIENT_ID: "client", PIPEDRIVE_OAUTH_CLIENT_SECRET: "secret", PIPEDRIVE_OAUTH_ENCRYPTION_KEY: "key", AUDIT_HMAC_KEY: "audit",
  } as any);
  assert.equal(config.oauthCallbackUrl, "https://mcp.example.test/oauth/pipedrive/callback");
  assert.equal(requestUsesConfiguredOrigin(new Request("https://mcp.example.test/pipedrive"), config), true);
  assert.equal(requestUsesConfiguredOrigin(new Request("https://evil.example.test/pipedrive"), config), false);
});

test("remote environment rejects invalid deployment names and public origins", () => {
  assert.throws(() => deploymentEnvironment("preview"), /DEPLOY_ENVIRONMENT/);
  for (const origin of ["http://mcp.example.test", "https://mcp.example.test/path", "https://user@mcp.example.test", "https://mcp.example.test:8443"]) {
    assert.throws(() => publicOrigin(origin), /PUBLIC_ORIGIN/);
  }
});
