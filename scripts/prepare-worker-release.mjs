import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configPath, loadTopology, requiredSecrets, requiredVariables, targets } from "./validate-worker-topology.mjs";
import { validateClientTarget } from "./validate-client-environment.mjs";
import { requiredClientArtifactRecord } from "./worker-release-client.mjs";

const root = process.cwd();
const target = argument("--target");
if (!target || !(target in targets)) throw new Error("Usage: node scripts/prepare-worker-release.mjs --target sandbox|production");

const config = loadTopology(target, root);
const client = validateClientTarget(target, root);
const sourceTreeClean = sourceTreeIsClean();
if (!sourceTreeClean && process.env.WORKER_RELEASE_TEST_ALLOW_DIRTY !== "true") {
  throw new Error("worker_release_tree_dirty");
}
const releaseRoot = join(root, "dist", "releases", target);
const output = join(releaseRoot, "worker");
const inputManifestPath = join(releaseRoot, "input-manifest.json");
const recordPath = join(releaseRoot, "release-record.json");
const wrangler = join(root, "node_modules", ".bin", "wrangler");
const origin = config.vars.PUBLIC_ORIGIN;
const clientArtifact = requiredClientArtifactRecord(target, root);
const inputManifest = {
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
  client_metadata_sha256: client.hash,
};
const inputManifestText = `${canonicalJson(inputManifest)}\n`;

mkdirSync(releaseRoot, { recursive: true });
writeFileSync(inputManifestPath, inputManifestText);
execFileSync(wrangler, ["deploy", "--config", configPath(target, root), "--dry-run", "--outdir", output], {
  cwd: root,
  stdio: "inherit",
});

const record = {
  schema: 2,
  target,
  git_sha: git("rev-parse", "HEAD"),
  git_tree_sha: git("rev-parse", "HEAD^{tree}"),
  deployable: sourceTreeClean,
  test_fixture: !sourceTreeClean,
  lock_sha256: hashFile(join(root, "package-lock.json")),
  config_sha256: inputManifest.config_sha256,
  input_manifest_sha256: hashText(inputManifestText),
  worker_bundle_sha256: hashFile(join(output, "worker.js")),
  worker_output_tree_sha256: hashWorkerOutputTree(output),
  client: clientArtifact,
  node_version: process.version,
  npm_version: execFileSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).trim(),
  wrangler_version: execFileSync(wrangler, ["--version"], { cwd: root, encoding: "utf8" }).trim(),
  worker: config.name,
  public_origin: origin,
  mcp_url: `${origin}/mcp`,
  oauth_callback_url: `${origin}/oauth/pipedrive/callback`,
  access_application_label: targets[target].accessApplicationLabel,
  pipedrive_application_label: targets[target].pipedriveApplicationLabel,
  required_variables: requiredVariables,
  required_secrets: requiredSecrets,
};
writeFileSync(recordPath, `${canonicalJson(record)}\n`);
console.log(`worker_release_record=${recordPath}`);

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
function sourceTreeIsClean() { return git("status", "--porcelain", "--untracked-files=all") === ""; }
function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
