import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configPath, requiredSecrets, requiredVariables, targets } from "./validate-worker-topology.mjs";

export function assertGitHubActions(env = process.env) {
  if (env.GITHUB_ACTIONS !== "true") throw new Error("worker_deploy_github_actions_required");
}

export function deploymentPlan(target, env = process.env, root = process.cwd()) {
  if (!target || !(target in targets)) throw new Error("Usage: node scripts/deploy-worker-release.mjs --target sandbox|production");
  const variables = protectedVariables(env);
  const secrets = requiredValues(requiredSecrets, env, "worker_deploy_secret_missing");
  const cloudflare = requiredValues(["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"], env, "worker_deploy_cloudflare_missing");
  return {
    target,
    config: configPath(target, root),
    worker: targets[target].worker,
    variables,
    secrets,
    cloudflare,
  };
}

function protectedVariables(env) {
  const issuer = deploymentText(env.ACCESS_ISSUER, "ACCESS_ISSUER");
  let issuerUrl;
  try { issuerUrl = new URL(issuer); } catch { throw new Error("worker_deploy_input_invalid:ACCESS_ISSUER"); }
  if (issuerUrl.protocol !== "https:" || issuerUrl.username || issuerUrl.password || issuerUrl.port || issuerUrl.pathname !== "/" || issuerUrl.search || issuerUrl.hash) {
    throw new Error("worker_deploy_input_invalid:ACCESS_ISSUER");
  }
  const audience = deploymentText(env.ACCESS_AUD, "ACCESS_AUD");
  const email = deploymentText(env.REMOTE_ADMIN_EMAIL, "REMOTE_ADMIN_EMAIL").toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("worker_deploy_input_invalid:REMOTE_ADMIN_EMAIL");
  }
  return { ACCESS_ISSUER: issuerUrl.origin, ACCESS_AUD: audience, REMOTE_ADMIN_EMAIL: email };
}

function deploymentText(value, name) {
  if (typeof value !== "string") throw new Error(`worker_deploy_input_missing:${name}`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 4096 || /placeholder|todo|example/i.test(normalized)) {
    throw new Error(`worker_deploy_input_invalid:${name}`);
  }
  return normalized;
}

function main() {
  const root = process.cwd();
  const target = argument("--target");
  assertGitHubActions();
  const plan = deploymentPlan(target, process.env, root);
  const record = JSON.parse(readFileSync(join(root, "dist", "releases", target, "release-record.json"), "utf8"));
  if (record.deployable !== true || record.test_fixture === true) {
    throw new Error("worker_release_record_not_deployable");
  }
  assertCleanTree(root);
  execFileSync(process.execPath, ["scripts/verify-worker-release.mjs", "--target", target], {
    cwd: root,
    stdio: "inherit",
  });
  assertCleanTree(root);
  withSecretsFile(plan.secrets, (secretsFile) => {
    const args = ["deploy", "--config", plan.config];
    for (const name of requiredVariables) args.push("--var", `${name}:${plan.variables[name]}`);
    args.push("--secrets-file", secretsFile);
    execFileSync(join(root, "node_modules", ".bin", "wrangler"), args, { cwd: root, stdio: "inherit" });
  });
}

function requiredValues(names, env, errorCode) {
  return Object.fromEntries(names.map((name) => {
    const value = env[name];
    if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) throw new Error(`${errorCode}:${name}`);
    return [name, value];
  }));
}

function withSecretsFile(secrets, action) {
  const directory = mkdtempSync(join(tmpdir(), "pipedrive-worker-secrets-"));
  const file = join(directory, "worker-secrets.json");
  try {
    writeFileSync(file, secretsFileContents(secrets), { mode: 0o600 });
    chmodSync(file, 0o600);
    return action(file);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function secretsFileContents(secrets) { return JSON.stringify(secrets); }

function assertCleanTree(root) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim();
  if (status) throw new Error("worker_release_tree_dirty");
}

function argument(name) { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1]; }
if (import.meta.url === new URL(process.argv[1], "file:").href) main();
