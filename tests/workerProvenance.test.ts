import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import test from "node:test";

const inputs = {
  ...process.env,
  ACCESS_ISSUER: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "aud-synthetic",
  REMOTE_ADMIN_EMAIL: "admin@pezzos.test",
  WORKER_RELEASE_TEST_ALLOW_DIRTY: "true",
};

test("sandbox release provenance refuses dirty source by default and records a reproducible non-deployable fixture", { timeout: 120_000 }, () => {
  const dirtyMarker = "tests/.worker-release-dirty-fixture";
  writeFileSync(dirtyMarker, "fixture\n");
  try {
    const defaultEnvironment = { ...inputs };
    delete defaultEnvironment.WORKER_RELEASE_TEST_ALLOW_DIRTY;
    assert.throws(
      () => execFileSync(process.execPath, ["scripts/prepare-worker-release.mjs", "--target", "sandbox"], {
        env: defaultEnvironment,
        stdio: "pipe",
      }),
      /worker_release_tree_dirty/,
    );
  } finally {
    unlinkSync(dirtyMarker);
  }
  execFileSync("npm", ["run", "pack:chatgpt-plugin"], { env: inputs, stdio: "pipe" });
  const prepare = () => execFileSync(process.execPath, ["scripts/prepare-worker-release.mjs", "--target", "sandbox"], { env: inputs, stdio: "pipe" });
  prepare();
  const first = readFileSync("dist/releases/sandbox/release-record.json", "utf8");
  const manifest = readFileSync("dist/releases/sandbox/input-manifest.json", "utf8");
  prepare();
  const second = readFileSync("dist/releases/sandbox/release-record.json", "utf8");
  assert.equal(second, first);
  execFileSync(process.execPath, ["scripts/verify-worker-release.mjs", "--target", "sandbox"], { env: inputs, stdio: "pipe" });
  const record = JSON.parse(second);
  assert.equal(record.schema, 2);
  assert.equal(record.deployable, false);
  assert.equal(record.test_fixture, true);
  assert.equal(record.target, "sandbox");
  assert.equal(record.public_origin, "https://pipedrive-mcp-sandbox.pezzoslabs.com");
  assert.equal(record.oauth_callback_url, "https://pipedrive-mcp-sandbox.pezzoslabs.com/oauth/pipedrive/callback");
  assert.deepEqual(record.required_secrets, ["PIPEDRIVE_OAUTH_CLIENT_ID", "PIPEDRIVE_OAUTH_CLIENT_SECRET", "PIPEDRIVE_OAUTH_ENCRYPTION_KEY", "AUDIT_HMAC_KEY"]);
  assert.match(manifest, /Pipedrive MCP Sandbox Access/);
  assert.match(manifest, /Pipedrive MCP Sandbox OAuth/);
  assert.equal(typeof record.worker_output_tree_sha256, "string");
  assert.equal(second.includes("aud-synthetic"), false);
  assert.equal(second.includes("admin@pezzos.test"), false);
  const recordPath = "dist/releases/sandbox/release-record.json";
  const toolchainDrift = { ...record, node_version: "v0.0.0" };
  writeFileSync(recordPath, `${JSON.stringify(toolchainDrift)}\n`);
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-worker-release.mjs", "--target", "sandbox"], { env: inputs, stdio: "pipe" }),
    /Expected values to be strictly equal/,
  );
  const workerDrift = { ...record, worker: "wrong-worker" };
  writeFileSync(recordPath, `${JSON.stringify(workerDrift)}\n`);
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-worker-release.mjs", "--target", "sandbox"], { env: inputs, stdio: "pipe" }),
    /Expected values to be strictly equal/,
  );
  writeFileSync(recordPath, second);
});
