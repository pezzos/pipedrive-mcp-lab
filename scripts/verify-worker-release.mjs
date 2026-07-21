import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configPath, loadTopology, requiredSecrets, requiredVariables, optionalSecrets, optionalVariables, targets } from "./validate-worker-topology.mjs";
import { validateClientTarget } from "./validate-client-environment.mjs";
import { requiredClientArtifactRecord } from "./worker-release-client.mjs";

const root = process.cwd();
const target = argument("--target");
if (!target || !(target in targets)) throw new Error("Usage: node scripts/verify-worker-release.mjs --target sandbox|production");
const releaseRoot = join(root, "dist", "releases", target);
const output = join(releaseRoot, "worker");
const record = JSON.parse(readFileSync(join(releaseRoot, "release-record.json"), "utf8"));
const inputManifestPath = join(releaseRoot, "input-manifest.json");
const config = loadTopology(target, root);
const client = validateClientTarget(target, root);
const origin = config.vars.PUBLIC_ORIGIN;
const expectedManifest = {
  schema: 1,
  target,
  worker: config.name,
  public_origin: origin,
  mcp_url: `${origin}/mcp`,
  oauth_callback_url: `${origin}/oauth/pipedrive/callback`,
  access_application_label: targets[target].accessApplicationLabel,
  pipedrive_application_label: targets[target].pipedriveApplicationLabel,
  config_sha256: hashFile(configPath(target, root)),
  required_variables: requiredVariables,
  required_secrets: requiredSecrets,
  optional_variables: optionalVariables,
  optional_secrets: optionalSecrets,
  client_metadata_sha256: client.hash,
};

assert.equal(record.schema, 2);
assert.equal(record.target, target);
if ((!record.deployable || record.test_fixture) && process.env.WORKER_RELEASE_TEST_ALLOW_DIRTY !== "true") {
  throw new Error("worker_release_record_not_deployable");
}
assert.equal(record.git_sha, git("rev-parse", "HEAD"));
assert.equal(record.git_tree_sha, git("rev-parse", "HEAD^{tree}"));
assert.equal(record.node_version, process.version);
assert.equal(record.npm_version, execFileSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).trim());
assert.equal(record.wrangler_version, execFileSync(join(root, "node_modules", ".bin", "wrangler"), ["--version"], { cwd: root, encoding: "utf8" }).trim());
assert.equal(record.config_sha256, hashFile(configPath(target, root)));
assert.equal(record.lock_sha256, hashFile(join(root, "package-lock.json")));
assert.equal(record.input_manifest_sha256, hashText(`${canonicalJson(expectedManifest)}\n`));
assert.equal(readFileSync(inputManifestPath, "utf8"), `${canonicalJson(expectedManifest)}\n`);
assert.equal(record.worker_bundle_sha256, hashFile(join(output, "worker.js")));
assert.equal(record.worker_output_tree_sha256, hashWorkerOutputTree(output));
assert.deepEqual(record.client, requiredClientArtifactRecord(target, root));
assert.deepEqual(record.required_variables, requiredVariables);
assert.deepEqual(record.required_secrets, requiredSecrets);
assert.deepEqual(record.optional_variables, optionalVariables);
assert.deepEqual(record.optional_secrets, optionalSecrets);
assert.equal(record.public_origin, origin);
assert.equal(record.oauth_callback_url, `${origin}/oauth/pipedrive/callback`);
assert.equal(record.mcp_url, `${origin}/mcp`);
assert.equal(record.worker, config.name);
assert.equal(record.access_application_label, targets[target].accessApplicationLabel);
assert.equal(record.pipedrive_application_label, targets[target].pipedriveApplicationLabel);
console.log("worker_release_verified");

function hashWorkerOutputTree(directory) {
  return hashText(canonicalJson([["worker.js", hashFile(join(directory, "worker.js"))]]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function hashFile(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function hashText(value) { return createHash("sha256").update(value).digest("hex"); }
function git(...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
