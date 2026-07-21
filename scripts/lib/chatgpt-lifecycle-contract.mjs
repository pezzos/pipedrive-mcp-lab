import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CHATGPT_APP_ID,
  CHATGPT_MCP_URL,
  CHATGPT_PLUGIN_SLUG,
  CHATGPT_REMOTE_PLUGIN_ID,
  CHATGPT_SKILLS,
} from "./chatgpt-plugin-contract.mjs";
import { walk } from "./artifact-safety.mjs";

export const LIFECYCLE_FORMAT = "pipedrive-chatgpt-lifecycle-release-v1";
export const LIFECYCLE_STATE_FORMAT = "pipedrive-chatgpt-lifecycle-state-v1";
export const LIFECYCLE_SELECTOR = `${CHATGPT_PLUGIN_SLUG}@${CHATGPT_PLUGIN_SLUG}`;
export const LIFECYCLE_ROOT = "dist/chatgpt-lifecycle";

export function lifecycleRelease({ version, receipt }) {
  assertReceipt(receipt);
  return {
    format: LIFECYCLE_FORMAT,
    schema_version: 1,
    plugin: {
      marketplace: CHATGPT_PLUGIN_SLUG,
      name: CHATGPT_PLUGIN_SLUG,
      selector: LIFECYCLE_SELECTOR,
      version,
      remote_plugin_id: CHATGPT_REMOTE_PLUGIN_ID,
      app_id: CHATGPT_APP_ID,
      required: true,
    },
    artifact: {
      relative_path: `../chatgpt-plugin/${CHATGPT_PLUGIN_SLUG}-${version}`,
      receipt_format: receipt.format,
      tree_sha256: receipt.tree_sha256,
    },
    direct_fallback: {
      name: CHATGPT_PLUGIN_SLUG,
      transport: "streamable-http",
      url: CHATGPT_MCP_URL,
      bearer_token_env_var: null,
    },
    skills: [...CHATGPT_SKILLS].sort(),
  };
}

export function loadReceipt(path) {
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  assertReceipt(receipt);
  return receipt;
}

export function assertReceipt(receipt) {
  if (!receipt || receipt.format !== "pipedrive-chatgpt-plugin-receipt-v1" || !Array.isArray(receipt.files)) {
    throw new Error("B3 requires the receipt-verified B2 ChatGPT package");
  }
  const tree = receipt.files.map((file) => `${file.path}\0${file.mode}\0${file.sha256}\n`).join("");
  if (createHash("sha256").update(tree).digest("hex") !== receipt.tree_sha256) {
    throw new Error("B2 ChatGPT receipt tree hash is invalid");
  }
}

export function assertArtifactMatchesReceipt(artifactRoot, receipt) {
  assertReceipt(receipt);
  const actual = [...walk(artifactRoot)].map((file) => ({
    path: relative(artifactRoot, file),
    mode: (lstatSync(file).mode & 0o777).toString(8).padStart(4, "0"),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  })).sort((a, b) => a.path.localeCompare(b.path));
  if (JSON.stringify(actual) !== JSON.stringify(receipt.files)) {
    throw new Error("B2 ChatGPT artifact differs from its verified receipt");
  }
}

export function receiptForTree(root, artifact) {
  const files = [...walk(root)].map((file) => ({
    path: relative(root, file),
    mode: (lstatSync(file).mode & 0o777).toString(8).padStart(4, "0"),
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  })).sort((a, b) => a.path.localeCompare(b.path));
  const tree = files.map((file) => `${file.path}\0${file.mode}\0${file.sha256}\n`).join("");
  return { format: "pipedrive-chatgpt-plugin-receipt-v1", artifact, files, tree_sha256: createHash("sha256").update(tree).digest("hex") };
}

export function exactTreeSnapshot(root) {
  if (!existsSync(root)) return [];
  const entries = [];
  const visit = (directory) => {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("lifecycle_refused:nonregular_profile_entry");
    entries.push({ path: relative(root, directory) || ".", type: "directory", mode: mode(stat) });
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name);
      const child = lstatSync(file);
      if (child.isSymbolicLink() || (!child.isDirectory() && !child.isFile())) throw new Error("lifecycle_refused:nonregular_profile_entry");
      if (child.isDirectory()) visit(file);
      else entries.push({ path: relative(root, file), type: "file", mode: mode(child), size: child.size, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") });
    }
  };
  visit(root);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertExactTree(root, expected, code = "lifecycle_refused:managed_content_modified") {
  if (JSON.stringify(exactTreeSnapshot(root)) !== JSON.stringify(expected)) throw new Error(code);
}

export function atomicCopyTree(source, target) {
  const staging = `${target}.staging`;
  rmSync(staging, { recursive: true, force: true });
  cpSync(source, staging, { recursive: true, dereference: false, preserveTimestamps: false });
  renameSync(staging, target);
}

function mode(stat) { return (stat.mode & 0o777).toString(8).padStart(4, "0"); }

export function normalizedSelection(selection) {
  const values = selection == null || selection === "all" ? [...CHATGPT_SKILLS] : selection;
  if (!Array.isArray(values) || values.some((skill) => typeof skill !== "string" || !CHATGPT_SKILLS.includes(skill))) {
    throw new Error("Skill selection must be all or an approved ChatGPT skill subset");
  }
  const skills = [...new Set(values)].sort();
  return skills.length === CHATGPT_SKILLS.length ? "all" : skills;
}

export function lifecycleState({ release, enabled, baseline_snapshot, baseline_config, created_paths, managed_cache, config_blocks, config_created }) {
  const app = true;
  return {
    format: LIFECYCLE_STATE_FORMAT,
    schema_version: 1,
    selector: release.plugin.selector,
    installation: "plugin",
    status: enabled ? "enabled" : "disabled",
    version: release.plugin.version,
    release_tree_sha256: release.artifact.tree_sha256,
    ownership: { marketplace: app, plugin: app, app, direct_fallback: false },
    selection: "all",
    skills: [...release.skills].sort(),
    mcp: { owner: "app", name: CHATGPT_PLUGIN_SLUG, url: null },
    cache_root: managed_cache.root,
    state_file: `.pipedrive-mcp-lifecycle/${CHATGPT_PLUGIN_SLUG}.json`,
    config_sections: [`plugins.${LIFECYCLE_SELECTOR}`, `marketplaces.${CHATGPT_PLUGIN_SLUG}`],
    created_paths: [...created_paths].sort(),
    managed_cache,
    config_blocks,
    config_created,
    baseline_config,
    baseline_snapshot,
  };
}

export function statePath(profileRoot) {
  return join(profileRoot, ".pipedrive-mcp-lifecycle", `${CHATGPT_PLUGIN_SLUG}.json`);
}

export function releasePath(repoRoot) {
  return join(repoRoot, LIFECYCLE_ROOT, "pipedrive-sandbox-release.json");
}

export function isRegularFile(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

export function planDirectMcp(listings = []) {
  if (!Array.isArray(listings)) throw new Error("MCP fixture listing must be an array");
  const normalized = listings.map((entry) => ({ name: entry?.name, url: entry?.url }));
  if (normalized.some((entry) => entry.name === CHATGPT_PLUGIN_SLUG)) {
    throw new Error("direct_mcp_conflict_name; remove the existing MCP explicitly");
  }
  if (normalized.some((entry) => entry.url === CHATGPT_MCP_URL)) {
    throw new Error("direct_mcp_conflict_url; remove the existing MCP explicitly");
  }
  return {
    command: ["codex", "mcp", "add", CHATGPT_PLUGIN_SLUG, "--url", CHATGPT_MCP_URL],
    name: CHATGPT_PLUGIN_SLUG,
    transport: "streamable-http",
    url: CHATGPT_MCP_URL,
    bearer_token_env_var: null,
    external_gate: "B8",
    status: "direct_mcp_external_gate_required",
  };
}

export function classifyDirectMcpDiagnostic(error) {
  const text = String(error ?? "").toLowerCase();
  if (text.includes("invalid_client_metadata") || text.includes("registration failed")) {
    return { code: "direct_mcp_registration_unaccepted", guidance: "Do not retry automatically or add secrets. Defer registration and authentication to B8." };
  }
  if (/(dns|enotfound|connect|timeout|timed out|\b5\d\d\b)/.test(text)) {
    return { code: "offline_mcp_diagnostic", guidance: "Plugin installed. Check network, VPN, and Cloudflare Access; then retry. Do not reinstall or add secrets. Reconnect only for an authentication-specific error." };
  }
  return { code: "direct_mcp_unknown", guidance: "Do not reinstall or add secrets; retain the diagnostic and defer registration/authentication to B8." };
}

export function materializeStandaloneSkills({ artifactRoot, receipt, destination, selection }) {
  assertArtifactMatchesReceipt(artifactRoot, receipt);
  const selected = normalizedSelection(selection);
  const skills = selected === "all" ? [...CHATGPT_SKILLS] : selected;
  for (const skill of skills) {
    const source = join(artifactRoot, "plugins", CHATGPT_PLUGIN_SLUG, "skills", skill, "SKILL.md");
    const target = join(destination, skill, "SKILL.md");
    mkdirSync(join(destination, skill), { recursive: true, mode: 0o700 });
    cpSync(source, target, { dereference: false });
    chmodSync(target, 0o644);
  }
  return { skills: [...skills].sort(), connector: "direct_mcp_external_gate_required" };
}

export function stageStandaloneSkills({ artifactRoot, receipt, destination, selection, lifecycleRoot, ownedDestinationSnapshot, testFailAfterReplace = false }) {
  const allowed = join(lifecycleRoot, "standalone");
  if (!destination.startsWith(`${allowed}/`) || destination.includes("..")) throw new Error("lifecycle_refused:standalone_destination_escape");
  let cursor = allowed;
  for (const part of relative(allowed, destination).split("/")) { if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("lifecycle_refused:symlink_escape"); cursor = join(cursor, part); }
  if (existsSync(destination) && JSON.stringify(exactTreeSnapshot(destination)) !== JSON.stringify(ownedDestinationSnapshot ?? [])) throw new Error("lifecycle_refused:foreign_standalone_content");
  const staging = `${destination}.staging`; const backup = `${destination}.backup`;
  rmSync(staging, { recursive: true, force: true });
  const result = materializeStandaloneSkills({ artifactRoot, receipt, destination: staging, selection });
  assertArtifactMatchesReceipt(artifactRoot, receipt);
  try {
    if (existsSync(destination)) renameSync(destination, backup);
    renameSync(staging, destination); if (testFailAfterReplace) throw new Error("lifecycle_test_failure:standalone_replace"); rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    rmSync(destination, { recursive: true, force: true }); if (existsSync(backup)) renameSync(backup, destination); rmSync(staging, { recursive: true, force: true }); throw error;
  }
  return result;
}
