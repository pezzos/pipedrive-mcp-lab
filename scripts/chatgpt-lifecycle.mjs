import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  LIFECYCLE_ROOT, LIFECYCLE_SELECTOR, assertArtifactMatchesReceipt, assertExactTree,
  classifyDirectMcpDiagnostic, exactTreeSnapshot, lifecycleState, loadReceipt,
  planDirectMcp, releasePath, statePath,
} from "./lib/chatgpt-lifecycle-contract.mjs";
import { CHATGPT_MCP_URL, CHATGPT_PLUGIN_SLUG } from "./lib/chatgpt-plugin-contract.mjs";

const repoRoot = process.cwd();
const [command, scenario, ...options] = process.argv.slice(2);
if (!command || !scenario || !["install", "update", "disable", "enable", "uninstall", "status", "diagnostic"].includes(command)) throw new Error("Usage: chatgpt-lifecycle <command> <scenario> [--release=current|previous]");
const profile = profileRoot(scenario);
const parsed = parseOptions(options);
if (command === "diagnostic") console.log(JSON.stringify(classifyDirectMcpDiagnostic(options.join(" "))));
else if (command === "status") console.log(JSON.stringify(readState(profile) ?? { status: "not-installed" }, null, 2));
else if (parsed.mode === "technical-fallback") registerDirectMcp(planDirectMcp());
else {
  if (command === "install") refuseConflicts(profile);
  transaction(scenario, profile, () => {
  if (command === "install") install(profile, loadRelease(parsed.release));
  if (command === "update") update(profile, loadRelease("current"));
  if (command === "disable" || command === "enable") toggle(profile, command === "enable");
  if (command === "uninstall") uninstall(profile);
  });
}

function parseOptions(args) {
  let release = "current"; let mode = "plugin";
  for (const arg of args) {
    if (arg.startsWith("--release=")) release = arg.slice(10);
    else if (arg.startsWith("--mode=")) mode = arg.slice(7);
    else throw new Error(`Unsupported lifecycle option: ${arg}`);
  }
  if (!["current", "previous"].includes(release) || !["plugin", "technical-fallback"].includes(mode)) throw new Error("Invalid lifecycle option");
  return { release, mode };
}

function profileRoot(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || slug.includes("..")) throw new Error("Scenario must be a generated-profile slug");
  const root = resolve(repoRoot, LIFECYCLE_ROOT, "profiles"); const target = resolve(root, slug);
  if (!target.startsWith(`${root}/`)) throw new Error("Lifecycle profile escapes dist");
  return target;
}

function loadRelease(kind) {
  const path = kind === "previous"
    ? join(repoRoot, LIFECYCLE_ROOT, "fixtures", "previous-release", "pipedrive-sandbox-release.json")
    : releasePath(repoRoot);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.format !== "pipedrive-chatgpt-lifecycle-release-v1" || value.schema_version !== 1) throw new Error("Invalid lifecycle release");
  if (kind === "previous" && value.synthetic_previous_release_fixture !== true) throw new Error("Previous release must be synthetic fixture");
  const artifactRoot = resolve(dirname(path), value.artifact.relative_path);
  if (!artifactRoot.startsWith(`${resolve(repoRoot, "dist")}/`)) throw new Error("Lifecycle artifact escapes dist");
  const receipt = loadReceipt(`${artifactRoot}.sha256.json`);
  assertArtifactMatchesReceipt(artifactRoot, receipt);
  if (receipt.tree_sha256 !== value.artifact.tree_sha256) throw new Error("Lifecycle receipt mismatch");
  return { ...value, artifactRoot, receipt };
}

function transaction(scenario, root, action) {
  preflight(root);
  const locks = join(repoRoot, LIFECYCLE_ROOT, "locks"); const txs = join(repoRoot, LIFECYCLE_ROOT, "transactions");
  const lock = join(locks, `${scenario}.lock`); const backup = join(txs, `${scenario}.backup`);
  mkdirSync(locks, { recursive: true, mode: 0o700 }); mkdirSync(txs, { recursive: true, mode: 0o700 });
  if (!existsSync(root) && existsSync(backup)) { renameSync(backup, root); }
  if (existsSync(root) && existsSync(backup)) throw new Error("lifecycle_refused:ambiguous_transaction_backup");
  mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700);
  preflight(root);
  try { mkdirSync(lock, { mode: 0o600 }); chmodSync(lock, 0o600); } catch { throw new Error("lifecycle_refused:exclusive_lock_unavailable"); }
  const baseline = exactTreeSnapshot(root);
  try {
    copy(root, backup);
    const result = action();
    fail("transaction-finalize");
    rmSync(backup, { recursive: true, force: true }); rmSync(lock, { recursive: true, force: true });
    return result;
  } catch (error) {
    try { rmSync(root, { recursive: true, force: true }); renameSync(backup, root); }
    finally { rmSync(lock, { recursive: true, force: true }); }
    throw error;
  }
}

function preflight(root) {
  if (existsSync(root)) exactTreeSnapshot(root);
  for (const ancestor of [join(repoRoot, "dist"), join(repoRoot, LIFECYCLE_ROOT), join(repoRoot, LIFECYCLE_ROOT, "profiles"), root]) {
    if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error("lifecycle_refused:symlink_escape");
  }
}

function refuseConflicts(root) {
  const config = join(root, "config.toml"); if (!existsSync(config)) return;
  const text = readFileSync(config, "utf8");
  if (text.includes(`[plugins."${LIFECYCLE_SELECTOR}"]`) || text.includes(`[marketplaces.${CHATGPT_PLUGIN_SLUG}]`)) throw new Error("lifecycle_refused:managed_state_missing");
  const url = normalizeUrl(CHATGPT_MCP_URL);
  const sections = [...text.matchAll(/\[mcp_servers\.([^\]]+)\]([\s\S]*?)(?=\n\[|$)/g)];
  for (const match of sections) {
    const name = match[1].replaceAll('"', ""); const found = /url\s*=\s*"([^"]+)"/.exec(match[2])?.[1];
    if (name === CHATGPT_PLUGIN_SLUG) throw new Error("lifecycle_refused:mcp_name_conflict");
    if (found && normalizeUrl(found) === url) throw new Error("lifecycle_refused:mcp_url_conflict");
  }
}

function normalizeUrl(value) { const url = new URL(value); if (url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, "") !== "/mcp") throw new Error("lifecycle_refused:mcp_url_invalid"); url.protocol = url.protocol.toLowerCase(); url.hostname = url.hostname.toLowerCase(); if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = ""; return url.toString().replace(/\/$/, ""); }

function install(root, release) {
  if (readState(root)) throw new Error("lifecycle_refused:already_managed");
  const baseline = exactTreeSnapshot(root);
  const baselineConfig = existsSync(join(root, "config.toml")) ? readFileSync(join(root, "config.toml"), "utf8") : null;
  runCodex(root, ["plugin", "marketplace", "add", release.artifactRoot, "--json"]); fail("marketplace-add");
  runCodex(root, ["plugin", "add", LIFECYCLE_SELECTOR, "--json"]); fail("plugin-add");
  const state = buildState(root, release, baseline, baselineConfig, true); fail("state-rename"); writeState(root, state);
  validateState(root, state); console.log(JSON.stringify(state, null, 2));
}

function update(root, next) {
  const state = requireState(root); validateState(root, state);
  const previous = loadReleaseForState(state);
  const disabled = state.status === "disabled";
  runCodex(root, ["plugin", "remove", LIFECYCLE_SELECTOR, "--json"]); fail("plugin-remove");
  runCodex(root, ["plugin", "marketplace", "remove", CHATGPT_PLUGIN_SLUG, "--json"]); fail("marketplace-remove");
  runCodex(root, ["plugin", "marketplace", "add", next.artifactRoot, "--json"]); fail("marketplace-add");
  runCodex(root, ["plugin", "add", LIFECYCLE_SELECTOR, "--json"]); fail("plugin-add");
  const stateNext = buildState(root, next, state.baseline_snapshot, state.baseline_config, !disabled); fail("state-rename"); writeState(root, stateNext); if (disabled) toggle(root, false);
  if (previous.plugin.version === next.plugin.version || previous.artifact.tree_sha256 === next.artifact.tree_sha256) throw new Error("lifecycle_refused:synthetic_update_not_distinct");
  validateState(root, requireState(root));
}

function toggle(root, enabled) {
  const state = requireState(root); validateState(root, state);
  const config = join(root, "config.toml"); const before = readFileSync(config, "utf8"); const block = section(before, `plugins."${LIFECYCLE_SELECTOR}"`);
  if (!block || !/^enabled = (true|false)$/m.test(block.text)) throw new Error("lifecycle_refused:selector_enabled_field_missing");
  const replacement = block.text.replace(/^enabled = (true|false)$/m, `enabled = ${enabled}`); const after = `${before.slice(0, block.start)}${replacement}${before.slice(block.end)}`;
  writeFileSync(config, after, { mode: 0o600 }); chmodSync(config, 0o600);
  const next = { ...state, status: enabled ? "enabled" : "disabled", config_blocks: configBlocks(after) }; writeState(root, next);
}

function uninstall(root) {
  const state = requireState(root); validateState(root, state);
  runCodex(root, ["plugin", "remove", LIFECYCLE_SELECTOR, "--json"]); fail("plugin-remove");
  runCodex(root, ["plugin", "marketplace", "remove", CHATGPT_PLUGIN_SLUG, "--json"]); fail("marketplace-remove");
  const cache = join(root, state.cache_root); if (existsSync(cache)) rmSync(cache, { recursive: true, force: false });
  rmSync(statePath(root), { force: true }); rmSync(`${statePath(root)}.staging`, { force: true });
  try { rmdirSync(dirname(statePath(root))); } catch {}
  removeCreated(root, state.created_paths);
  cleanConfig(root, state);
  assertUninstallPostconditions(root, state);
  console.log(JSON.stringify({ status: "uninstalled", selector: LIFECYCLE_SELECTOR }));
}

function buildState(root, release, baseline, baselineConfig, enabled) {
  const cacheRoot = `plugins/cache/${CHATGPT_PLUGIN_SLUG}/${CHATGPT_PLUGIN_SLUG}`;
  const after = exactTreeSnapshot(root); const before = new Set(baseline.map((entry) => entry.path));
  const configPath = join(root, "config.toml");
  return lifecycleState({ release, enabled, baseline_snapshot: baseline, baseline_config: baselineConfig, created_paths: after.map((entry) => entry.path).filter((path) => !before.has(path) && path !== "." && path !== "config.toml").sort(), managed_cache: { root: cacheRoot, entries: exactTreeSnapshot(join(root, cacheRoot)) }, config_blocks: configBlocks(readFileSync(configPath, "utf8")), config_created: !baseline.some((entry) => entry.path === "config.toml") });
}

function validateState(root, state) {
  if (state.format !== "pipedrive-chatgpt-lifecycle-state-v1" || state.installation !== "plugin" || state.ownership?.direct_fallback) throw new Error("lifecycle_refused:foreign_or_invalid_state");
  const cache = join(root, state.cache_root); assertExactTree(cache, state.managed_cache.entries);
  const config = join(root, "config.toml"); if (!existsSync(config) || JSON.stringify(configBlocks(readFileSync(config, "utf8"))) !== JSON.stringify(state.config_blocks)) throw new Error("lifecycle_refused:managed_content_modified");
}

function configBlocks(text) { const plugin = section(text, `plugins."${LIFECYCLE_SELECTOR}"`); const marketplace = section(text, `marketplaces.${CHATGPT_PLUGIN_SLUG}`); if (!plugin || !marketplace) throw new Error("lifecycle_refused:managed_content_modified"); return { plugin: plugin.text, marketplace: marketplace.text }; }
function section(text, key) { const marker = `[${key}]`; const start = text.indexOf(marker); if (start < 0 || text.indexOf(marker, start + marker.length) >= 0) return null; const next = text.indexOf("\n[", start + marker.length); const raw = text.slice(start, next < 0 ? text.length : next + 1); return { start, end: next < 0 ? text.length : next + 1, text: raw.replace(/\n+$/, "\n") }; }
function readState(root) { const path = statePath(root); return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null; }
function requireState(root) { const state = readState(root); if (!state) throw new Error("lifecycle_refused:managed_state_missing"); return state; }
function loadReleaseForState(state) { return loadRelease(state.version === "0.3.3" ? "previous" : "current"); }
function writeState(root, state) { const path = statePath(root); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); const staging = `${path}.staging`; writeFileSync(staging, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); renameSync(staging, path); chmodSync(path, 0o600); }
function removeCreated(root, paths) { for (const path of [...paths].sort((a, b) => b.length - a.length)) { const target = join(root, path); if (!existsSync(target)) continue; const stat = lstatSync(target); if (stat.isFile()) rmSync(target); else if (stat.isDirectory()) { try { rmdirSync(target); } catch {} } } }
function cleanConfig(root, state) { const config = join(root, "config.toml"); if (!existsSync(config)) return; const text = readFileSync(config, "utf8"); if (state.config_created && /^\s*$/.test(text)) rmSync(config); }
function snapshotWithoutConfig(root) { return exactTreeSnapshot(root).filter((entry) => entry.path !== "config.toml"); }
function assertUninstallPostconditions(root, state) {
  const config = join(root, "config.toml");
  const text = existsSync(config) ? readFileSync(config, "utf8") : null;
  const pluginMarker = `[plugins."${LIFECYCLE_SELECTOR}"]`;
  const marketplaceMarker = `[marketplaces.${CHATGPT_PLUGIN_SLUG}]`;
  if (text?.includes(pluginMarker) || text?.includes(marketplaceMarker)) throw new Error("lifecycle_refused:owned_config_residue");
  if (existsSync(statePath(root)) || existsSync(`${statePath(root)}.staging`) || existsSync(join(root, state.cache_root))) throw new Error("lifecycle_refused:owned_state_residue");
  if (JSON.stringify(snapshotWithoutConfig(root)) !== JSON.stringify(state.baseline_snapshot.filter((entry) => entry.path !== "config.toml"))) throw new Error("lifecycle_refused:baseline_restore_mismatch");
  if (state.baseline_config === null) {
    if (text !== null && /^\s*$/.test(text)) throw new Error("lifecycle_refused:empty_created_config_residue");
  } else {
    if (text === null || !text.startsWith(state.baseline_config)) throw new Error("lifecycle_refused:baseline_config_not_preserved");
  }
}
function copy(source, target) { rmSync(target, { recursive: true, force: true }); mkdirSync(dirname(target), { recursive: true, mode: 0o700 }); const staging = `${target}.staging`; rmSync(staging, { recursive: true, force: true }); const modes = exactTreeSnapshot(source); cpSync(source, staging, { recursive: true, dereference: false }); for (const entry of modes) chmodSync(entry.path === "." ? staging : join(staging, entry.path), Number.parseInt(entry.mode, 8)); renameSync(staging, target); }
function fail(point) { if (process.env.PIPEDRIVE_LIFECYCLE_FAIL_AT === point) throw new Error(`lifecycle_test_failure:${point}`); }
function registerDirectMcp(_plan) { throw new Error("direct_mcp_external_gate_required"); }
function runCodex(root, args) { if (args[0] !== "plugin") throw new Error("lifecycle_refused:subprocess_not_allowlisted"); const env = isolatedEnv(root); return execFileSync("codex", args, { cwd: repoRoot, env, timeout: 30_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function isolatedEnv(root) { const home = join(root, ".home"); const temp = join(root, ".tmpdir"); const config = join(root, ".xdg-config"); const cache = join(root, ".xdg-cache"); for (const path of [home, temp, config, cache]) mkdirSync(path, { recursive: true, mode: 0o700 }); const keep = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMP", "TEMP"].reduce((out, key) => (process.env[key] ? { ...out, [key]: process.env[key] } : out), {}); return { ...keep, CODEX_HOME: root, HOME: home, XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache, TMPDIR: temp }; }
