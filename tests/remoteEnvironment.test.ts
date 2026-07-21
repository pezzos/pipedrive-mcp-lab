import assert from "node:assert/strict";
import test from "node:test";

import { deploymentEnvironment, loadRemoteConfig, publicOrigin, requestUsesConfiguredOrigin } from "../src/remote/env.js";

test("remote environment derives the callback only from a validated public origin", () => {
  const config = loadRemoteConfig({
    DEPLOY_ENVIRONMENT: "sandbox", PUBLIC_ORIGIN: "https://mcp.example.test",
    ACCESS_ISSUER: "https://access.example.test", ACCESS_AUD: "aud", REMOTE_ADMIN_EMAIL: "admin@example.test", REMOTE_ADMIN_SUB: "admin-sub",
    PIPEDRIVE_OAUTH_CLIENT_ID: "client", PIPEDRIVE_OAUTH_CLIENT_SECRET: "secret", PIPEDRIVE_OAUTH_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", AUDIT_HMAC_KEY: "__________________________________________8", PIPEDRIVE_OAUTH_CLIENT_EPOCH: "2026-Q3", PIPEDRIVE_OAUTH_ENCRYPTION_KID: "key-2026", AUDIT_HMAC_EPOCH: "2026-Q3",
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

test("rotation configuration accepts same-quarter IDs but rejects malformed cutoffs, origins, keys, and optional secrets", () => {
  const base: any = { DEPLOY_ENVIRONMENT: "sandbox", PUBLIC_ORIGIN: "https://mcp.example.test", ACCESS_ISSUER: "https://access.example.test", ACCESS_AUD: "aud", REMOTE_ADMIN_EMAIL: "admin@example.test", REMOTE_ADMIN_SUB: "admin-sub", PIPEDRIVE_OAUTH_CLIENT_ID: "client", PIPEDRIVE_OAUTH_CLIENT_SECRET: "secret", PIPEDRIVE_OAUTH_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", AUDIT_HMAC_KEY: "__________________________________________8", PIPEDRIVE_OAUTH_CLIENT_EPOCH: "2026-Q3-emergency", PIPEDRIVE_OAUTH_ENCRYPTION_KID: "key-2026", AUDIT_HMAC_EPOCH: "2026-Q3-emergency" };
  const near = new Date(Date.now() + 60_000).toISOString();
  const previousKey = Buffer.from(Uint8Array.from({ length: 32 }, () => 1)).toString("base64url");
  assert.doesNotThrow(() => loadRemoteConfig({ ...base, AUDIT_HMAC_PREVIOUS_EPOCH: "2026-Q3-hotfix", AUDIT_HMAC_PREVIOUS_KEY: previousKey, AUDIT_HMAC_PREVIOUS_VALID_UNTIL: near, ACCESS_PREVIOUS_ISSUER: "https://prior.example.test", ACCESS_PREVIOUS_AUD: "prior", ACCESS_PREVIOUS_VALID_UNTIL: near }));
  const access = { ACCESS_PREVIOUS_ISSUER: "https://prior.example.test", ACCESS_PREVIOUS_AUD: "prior", ACCESS_PREVIOUS_VALID_UNTIL: near };
  const audit = { AUDIT_HMAC_PREVIOUS_EPOCH: "2026-Q3-hotfix", AUDIT_HMAC_PREVIOUS_KEY: previousKey, AUDIT_HMAC_PREVIOUS_VALID_UNTIL: near };
  for (const value of [{ ...access, ACCESS_PREVIOUS_ISSUER: "https://prior.example.test/path" }, { ...access, ACCESS_PREVIOUS_VALID_UNTIL: "2026-01-01" }, { ...audit, AUDIT_HMAC_PREVIOUS_VALID_UNTIL: new Date(Date.now() + 91 * 24 * 60 * 60_000).toISOString() }, { ...audit, AUDIT_HMAC_PREVIOUS_KEY: " key " }, { PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID: "old", PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }]) assert.throws(() => loadRemoteConfig({ ...base, ...value }), /remote_configuration_invalid/);
  assert.throws(() => loadRemoteConfig({ ...base, AUDIT_HMAC_KEY: base.PIPEDRIVE_OAUTH_ENCRYPTION_KEY }), /key_material_independent/);
  assert.throws(() => loadRemoteConfig({ ...base, AUDIT_HMAC_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB" }), /AUDIT_HMAC_KEY/);
});
