import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const targets = {
  sandbox: {
    worker: "pipedrive-mcp-sandbox",
    origin: "https://pipedrive-mcp-sandbox.pezzoslabs.com",
    accessApplicationLabel: "Pipedrive MCP Sandbox Access",
    pipedriveApplicationLabel: "Pipedrive MCP Sandbox OAuth",
  },
  production: {
    worker: "pipedrive-mcp-production",
    origin: "https://pipedrive-mcp.pezzoslabs.com",
    accessApplicationLabel: "Pipedrive MCP Production Access",
    pipedriveApplicationLabel: "Pipedrive MCP Production OAuth",
  },
};
export const requiredVariables = ["ACCESS_ISSUER", "ACCESS_AUD", "REMOTE_ADMIN_EMAIL", "REMOTE_ADMIN_SUB", "PIPEDRIVE_OAUTH_CLIENT_EPOCH", "PIPEDRIVE_OAUTH_ENCRYPTION_KID", "AUDIT_HMAC_EPOCH"];
export const requiredSecrets = ["PIPEDRIVE_OAUTH_CLIENT_ID", "PIPEDRIVE_OAUTH_CLIENT_SECRET", "PIPEDRIVE_OAUTH_ENCRYPTION_KEY", "AUDIT_HMAC_KEY"];
export const optionalSecrets = ["PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY", "AUDIT_HMAC_PREVIOUS_KEY"];
export const optionalVariables = ["PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID", "AUDIT_HMAC_PREVIOUS_EPOCH", "AUDIT_HMAC_PREVIOUS_VALID_UNTIL", "ACCESS_PREVIOUS_ISSUER", "ACCESS_PREVIOUS_AUD", "ACCESS_PREVIOUS_VALID_UNTIL"];

export function configPath(target, root = process.cwd()) {
  assertTarget(target);
  return resolve(root, `wrangler.${target}.jsonc`);
}

export function loadTopology(target, root = process.cwd()) {
  const config = JSON.parse(readFileSync(configPath(target, root), "utf8"));
  validateTopology(target, config);
  return config;
}

export function validateTopology(target, config) {
  assertTarget(target);
  const expected = targets[target];
  assert.equal(config.name, expected.worker, "worker name must match its target");
  assert.equal(config.main, "src/remote/worker.ts");
  assert.equal(config.keep_vars, false);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars?.DEPLOY_ENVIRONMENT, target);
  assert.equal(config.vars?.PUBLIC_ORIGIN, expected.origin);
  assert.equal(Object.prototype.hasOwnProperty.call(config, "script_name"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(config, "env"), false);
  assert.equal(JSON.stringify(config).includes("namespace_id"), false);
  const bindings = config.durable_objects?.bindings?.map((binding) => `${binding.name}:${binding.class_name}`).sort();
  assert.deepEqual(bindings, ["TENANT_REGISTRY:TenantRegistry", "USER_CONNECTION:UserConnection", "USER_POLICY:UserPolicy"]);
  assert.deepEqual(config.migrations, [
    { tag: "v1", new_sqlite_classes: ["UserPolicy", "TenantSecrets"] },
    { tag: "v2", new_sqlite_classes: ["UserConnection", "TenantRegistry"] },
  ]);
  return config;
}

export function validatePair(root = process.cwd()) {
  const sandbox = loadTopology("sandbox", root);
  const production = loadTopology("production", root);
  assert.notEqual(sandbox.name, production.name);
  assert.notEqual(sandbox.vars.PUBLIC_ORIGIN, production.vars.PUBLIC_ORIGIN);
  assert.deepEqual(sandbox.durable_objects, production.durable_objects);
  assert.deepEqual(sandbox.migrations, production.migrations);
  return { sandbox, production };
}

function assertTarget(target) {
  if (!(target in targets)) throw new Error("worker_target_invalid");
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const target = process.argv[3] === "--target" ? process.argv[4] : undefined;
  if (target) loadTopology(target);
  else validatePair();
  console.log("worker_topology_valid");
}
