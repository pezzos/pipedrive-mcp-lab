import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadTopology, requiredSecrets, requiredVariables, targets, validatePair, validateTopology } from "../scripts/validate-worker-topology.mjs";

test("sandbox and production Wrangler configurations are distinct, complete, and migration-compatible", () => {
  const { sandbox, production } = validatePair();
  assert.equal(sandbox.vars.PUBLIC_ORIGIN, targets.sandbox.origin);
  assert.equal(production.vars.PUBLIC_ORIGIN, targets.production.origin);
  assert.equal(readFileSync("wrangler.sandbox.jsonc", "utf8").includes(targets.production.origin), false);
  assert.equal(readFileSync("wrangler.production.jsonc", "utf8").includes(targets.sandbox.origin), false);
  assert.notEqual(targets.sandbox.accessApplicationLabel, targets.production.accessApplicationLabel);
  assert.notEqual(targets.sandbox.pipedriveApplicationLabel, targets.production.pipedriveApplicationLabel);
  assert.deepEqual(requiredVariables, ["ACCESS_ISSUER", "ACCESS_AUD", "REMOTE_ADMIN_EMAIL"]);
  assert.deepEqual(requiredSecrets, ["PIPEDRIVE_OAUTH_CLIENT_ID", "PIPEDRIVE_OAUTH_CLIENT_SECRET", "PIPEDRIVE_OAUTH_ENCRYPTION_KEY", "AUDIT_HMAC_KEY"]);
});

test("topology validator rejects a target with ambiguous retained variables", () => {
  const config = structuredClone(loadTopology("sandbox"));
  config.keep_vars = true;
  assert.throws(() => validateTopology("sandbox", config), /true/);
});

test("deployment workflow is manual only and deploys only from protected target environments", () => {
  const workflow = readFileSync(".github/workflows/deploy-worker.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bpush:|\bpull_request:|cloudflare\/wrangler-action/i);
  assert.match(workflow, /name: pipedrive-sandbox/);
  assert.match(workflow, /name: pipedrive-production/);
  assert.match(workflow, /deploy-sandbox:\n    if: inputs\.target == 'sandbox'\n    needs: prepare-sandbox\n    environment:/);
  assert.match(workflow, /deploy-production:\n    if: inputs\.target == 'production'\n    needs: prepare-production\n    environment:/);
  assert.match(workflow, /group: pipedrive-worker-sandbox-deployment/);
  assert.match(workflow, /group: pipedrive-worker-production-deployment/);
  const prepareSandbox = workflow.slice(workflow.indexOf("  prepare-sandbox:"), workflow.indexOf("  prepare-production:"));
  const prepareProduction = workflow.slice(workflow.indexOf("  prepare-production:"), workflow.indexOf("  deploy-sandbox:"));
  assert.doesNotMatch(prepareSandbox, /\n    environment:/);
  assert.doesNotMatch(prepareProduction, /\n    environment:/);
  assert.doesNotMatch(prepareSandbox, /ACCESS_(?:ISSUER|AUD)|REMOTE_ADMIN_EMAIL/);
  assert.doesNotMatch(prepareProduction, /ACCESS_(?:ISSUER|AUD)|REMOTE_ADMIN_EMAIL/);
  assert.match(prepareSandbox, /npm run pack:chatgpt-plugin/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  const deploySandbox = workflow.slice(workflow.indexOf("  deploy-sandbox:"), workflow.indexOf("  deploy-production:"));
  const deployProduction = workflow.slice(workflow.indexOf("  deploy-production:"));
  assert.match(deploySandbox, /npm ci/);
  assert.match(deployProduction, /npm ci/);
  assert.match(workflow, /deploy:worker-release -- --target sandbox/);
  assert.match(workflow, /deploy:worker-release -- --target production/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ vars\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(workflow, /PIPEDRIVE_OAUTH_CLIENT_ID: \$\{\{ secrets\.PIPEDRIVE_OAUTH_CLIENT_ID \}\}/);
  assert.match(workflow, /AUDIT_HMAC_KEY: \$\{\{ secrets\.AUDIT_HMAC_KEY \}\}/);
  assert.match(workflow, /git status --porcelain --untracked-files=all/);
});
