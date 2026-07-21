import assert from "node:assert/strict";
import test from "node:test";

import { assertGitHubActions, deploymentPlan, secretsFileContents } from "../scripts/deploy-worker-release.mjs";

const environment = {
  ACCESS_ISSUER: "https://team.cloudflareaccess.com",
  ACCESS_AUD: "aud-synthetic",
  REMOTE_ADMIN_EMAIL: "admin@pezzos.test",
  REMOTE_ADMIN_SUB: "admin-sub",
  PIPEDRIVE_OAUTH_CLIENT_EPOCH: "2026-Q3",
  PIPEDRIVE_OAUTH_ENCRYPTION_KID: "key-2026",
  AUDIT_HMAC_EPOCH: "2026-Q3",
  PIPEDRIVE_OAUTH_CLIENT_ID: "client-synthetic",
  PIPEDRIVE_OAUTH_CLIENT_SECRET: "secret-synthetic",
  PIPEDRIVE_OAUTH_ENCRYPTION_KEY: "key-synthetic",
  AUDIT_HMAC_KEY: "audit-synthetic",
  CLOUDFLARE_ACCOUNT_ID: "account-synthetic",
  CLOUDFLARE_API_TOKEN: "api-token-synthetic",
};

test("deployment plan fixes the target config and names without invoking Wrangler", () => {
  const plan = deploymentPlan("sandbox", environment);
  assert.match(plan.config, /wrangler\.sandbox\.jsonc$/);
  assert.equal(plan.worker, "pipedrive-mcp-sandbox");
  assert.deepEqual(Object.keys(plan.variables), ["ACCESS_ISSUER", "ACCESS_AUD", "REMOTE_ADMIN_EMAIL", "REMOTE_ADMIN_SUB", "PIPEDRIVE_OAUTH_CLIENT_EPOCH", "PIPEDRIVE_OAUTH_ENCRYPTION_KID", "AUDIT_HMAC_EPOCH"]);
  assert.deepEqual(Object.keys(plan.secrets), [
    "PIPEDRIVE_OAUTH_CLIENT_ID",
    "PIPEDRIVE_OAUTH_CLIENT_SECRET",
    "PIPEDRIVE_OAUTH_ENCRYPTION_KEY",
    "AUDIT_HMAC_KEY",
  ]);
  assert.deepEqual(Object.keys(plan.cloudflare), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
});

test("deployment plan normalizes only protected non-secret deployment variables", () => {
  const plan = deploymentPlan("sandbox", {
    ...environment,
    ACCESS_ISSUER: " https://team.cloudflareaccess.com/ ",
    ACCESS_AUD: " audience ",
    REMOTE_ADMIN_EMAIL: " Admin@Pezzos.Test ",
  });
  assert.deepEqual(plan.variables, {
    ACCESS_ISSUER: "https://team.cloudflareaccess.com",
    ACCESS_AUD: "audience",
    REMOTE_ADMIN_EMAIL: "admin@pezzos.test",
    REMOTE_ADMIN_SUB: "admin-sub",
    PIPEDRIVE_OAUTH_CLIENT_EPOCH: "2026-Q3",
    PIPEDRIVE_OAUTH_ENCRYPTION_KID: "key-2026",
    AUDIT_HMAC_EPOCH: "2026-Q3",
  });
});

test("deployment plan rejects malformed protected deployment variables", () => {
  for (const [name, value] of [
    ["ACCESS_ISSUER", "   "],
    ["ACCESS_AUD", "todo"],
    ["ACCESS_ISSUER", "http://team.cloudflareaccess.com"],
    ["ACCESS_ISSUER", "https://user@team.cloudflareaccess.com"],
    ["REMOTE_ADMIN_EMAIL", "not-an-email"],
  ]) {
    assert.throws(() => deploymentPlan("sandbox", { ...environment, [name]: value }), new RegExp(`worker_deploy_input_(?:missing|invalid):${name}`));
  }
  assert.throws(() => deploymentPlan("sandbox", { ...environment, ACCESS_AUD: "a".repeat(4097) }), /worker_deploy_input_invalid:ACCESS_AUD/);
});

test("deployment execution requires the GitHub Actions guard", () => {
  assert.throws(() => assertGitHubActions({}), /worker_deploy_github_actions_required/);
  assert.doesNotThrow(() => assertGitHubActions({ GITHUB_ACTIONS: "true" }));
});

test("Wrangler secrets JSON preserves special-character secret values losslessly", () => {
  const specialSecrets = {
    PIPEDRIVE_OAUTH_CLIENT_ID: ' client #1 ',
    PIPEDRIVE_OAUTH_CLIENT_SECRET: '"quoted"\\path=with#hash ',
    PIPEDRIVE_OAUTH_ENCRYPTION_KEY: "  leading and trailing  ",
    AUDIT_HMAC_KEY: "equals=and#hash",
  };
  assert.deepEqual(JSON.parse(secretsFileContents(specialSecrets)), specialSecrets);
});

test("deployment plan requires protected Cloudflare credentials", () => {
  const withoutAccount = { ...environment };
  delete withoutAccount.CLOUDFLARE_ACCOUNT_ID;
  assert.throws(() => deploymentPlan("sandbox", withoutAccount), /worker_deploy_cloudflare_missing:CLOUDFLARE_ACCOUNT_ID/);
  const withoutToken = { ...environment };
  delete withoutToken.CLOUDFLARE_API_TOKEN;
  assert.throws(() => deploymentPlan("sandbox", withoutToken), /worker_deploy_cloudflare_missing:CLOUDFLARE_API_TOKEN/);
});

test("deployment plan validates optional rotation groups", () => {
  const absent = deploymentPlan("sandbox", environment); assert.equal("PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID" in absent.variables, false);
  assert.throws(() => deploymentPlan("sandbox", { ...environment, PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID: "old" }), /worker_deploy_rotation_incomplete:OLD_ENCRYPTION/);
  assert.throws(() => deploymentPlan("sandbox", { ...environment, AUDIT_HMAC_PREVIOUS_EPOCH: "2026-Q2" }), /worker_deploy_rotation_incomplete:PREVIOUS_AUDIT/);
  assert.throws(() => deploymentPlan("sandbox", { ...environment, ACCESS_PREVIOUS_ISSUER: "https://previous.example" }), /worker_deploy_rotation_incomplete:PREVIOUS_ACCESS/);
  const complete = deploymentPlan("sandbox", { ...environment, PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID: "old", PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY: "old-secret", AUDIT_HMAC_PREVIOUS_EPOCH: "2026-Q2", AUDIT_HMAC_PREVIOUS_KEY: "previous-secret", AUDIT_HMAC_PREVIOUS_VALID_UNTIL: new Date(Date.now() + 60_000).toISOString(), ACCESS_PREVIOUS_ISSUER: "https://prior.invalid", ACCESS_PREVIOUS_AUD: "previous-aud", ACCESS_PREVIOUS_VALID_UNTIL: "2026-08-01T00:00:00.000Z" });
  assert.equal(complete.variables.PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID, "old"); assert.equal(complete.secrets.AUDIT_HMAC_PREVIOUS_KEY, "previous-secret");
});

test("deployment rotation boundaries require exact UTC values, canonical origins, and unpadded optional secrets", () => {
  const near = new Date(Date.now() + 60_000).toISOString();
  const complete = { ...environment, PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID: "old-hotfix", PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY: "old-secret", AUDIT_HMAC_PREVIOUS_EPOCH: "2026-Q3-hotfix", AUDIT_HMAC_PREVIOUS_KEY: "previous-secret", AUDIT_HMAC_PREVIOUS_VALID_UNTIL: near, ACCESS_PREVIOUS_ISSUER: "https://prior.invalid", ACCESS_PREVIOUS_AUD: "prior", ACCESS_PREVIOUS_VALID_UNTIL: near };
  assert.doesNotThrow(() => deploymentPlan("sandbox", complete));
  for (const patch of [{ AUDIT_HMAC_PREVIOUS_VALID_UNTIL: "2026-01-01" }, { AUDIT_HMAC_PREVIOUS_VALID_UNTIL: new Date(Date.now() + 91 * 24 * 60 * 60_000).toISOString() }, { ACCESS_PREVIOUS_ISSUER: "https://prior.invalid/path" }, { ACCESS_PREVIOUS_VALID_UNTIL: "2026-01-01" }, { AUDIT_HMAC_PREVIOUS_KEY: " previous-secret" }, { PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY: "old\nsecret" }]) assert.throws(() => deploymentPlan("sandbox", { ...complete, ...patch }), /worker_deploy_(?:input|secret)_invalid/);
});
