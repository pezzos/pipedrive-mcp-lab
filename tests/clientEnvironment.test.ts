import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateClientTarget } from "../scripts/validate-client-environment.mjs";

test("sandbox client metadata cannot target production and production preparation refuses absent metadata", () => {
  const source = JSON.parse(readFileSync("plugin/chatgpt/plugin-source.json", "utf8"));
  assert.equal(source.mcp_url, "https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp");
  assert.equal(validateClientTarget("sandbox").hash.length, 64);
  assert.throws(() => execFileSync(process.execPath, ["scripts/prepare-worker-release.mjs", "--target", "production"], {
    env: { ...process.env, ACCESS_ISSUER: "https://team.cloudflareaccess.com", ACCESS_AUD: "aud-value", REMOTE_ADMIN_EMAIL: "admin@company.test" },
    stdio: "pipe",
  }), /production_client_metadata_missing/);
});
