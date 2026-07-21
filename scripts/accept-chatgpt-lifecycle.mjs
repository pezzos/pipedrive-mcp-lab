import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  LIFECYCLE_SELECTOR,
  exactTreeSnapshot,
  classifyDirectMcpDiagnostic,
  loadReceipt,
  stageStandaloneSkills,
  normalizedSelection,
  planDirectMcp,
} from "./lib/chatgpt-lifecycle-contract.mjs";
import { CHATGPT_MCP_URL, CHATGPT_PLUGIN_SLUG, CHATGPT_SKILLS } from "./lib/chatgpt-plugin-contract.mjs";
import { applyProfileFixture } from "../tests/fixtures/chatgpt-lifecycle/codex-fixture.mjs";

const repoRoot = process.cwd();
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const profilesRoot = join(repoRoot, "dist", "chatgpt-lifecycle", "profiles");
const scenario = "accept-primary";
const profile = join(profilesRoot, scenario);
const artifact = join(repoRoot, "dist", "chatgpt-plugin", `${CHATGPT_PLUGIN_SLUG}-${version}`);
const previousArtifact = join(repoRoot, "dist", "chatgpt-lifecycle", "fixtures", "previous-release", "pipedrive-sandbox-0.3.3");
const resultsPath = join(repoRoot, "dist", "chatgpt-lifecycle", "results.json");
const fixture = JSON.parse(readFileSync(join(repoRoot, "tests", "fixtures", "chatgpt-lifecycle", "scenarios.json"), "utf8"));

execFileSync("npm", ["run", "pack:chatgpt-plugin"], { cwd: repoRoot, stdio: "pipe" });
execFileSync("npm", ["run", "pack:chatgpt-lifecycle"], { cwd: repoRoot, stdio: "pipe" });
const receipt = loadReceipt(`${artifact}.sha256.json`);
const previousReceipt = loadReceipt(`${previousArtifact}.sha256.json`);
rmSync(resultsPath, { force: true });
rmSync(`${resultsPath}.staging`, { force: true });
console.log(`codex_version: ${execFileSync("codex", ["--version"], { cwd: repoRoot, encoding: "utf8" }).trim()}`);
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true, mode: 0o700 });
applyProfileFixture(profile, fixture);
const unrelated = snapshotTree(profile);

// 1: clean generated profile, local marketplace and plugin install only.
runLifecycle("install", ["--release=previous"]);
let state = lifecycleState();
assert.equal(state.status, "enabled");
assert.equal(state.version, "0.3.3");

// 2: structural app package shape: exactly seven skills, one app declaration, zero direct MCP config.
let pluginRoot = join(profile, "plugins", "cache", CHATGPT_PLUGIN_SLUG, CHATGPT_PLUGIN_SLUG, "0.3.3");
assert.deepEqual(skillNames(pluginRoot), [...CHATGPT_SKILLS].sort());
assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(pluginRoot, ".app.json"), "utf8")).apps), [CHATGPT_PLUGIN_SLUG]);
assert.equal(readFileSync(join(profile, "config.toml"), "utf8").includes("mcp_servers"), false);

// 3: package, release, state, fixture, and local command plan contain no secret request.
const texts = [artifact, join(repoRoot, "dist", "chatgpt-lifecycle", "pipedrive-sandbox-release.json"), join(profile, ".pipedrive-mcp-lifecycle", `${CHATGPT_PLUGIN_SLUG}.json`)];
for (const path of texts) assert.equal(readTreeText(path).match(/(?:bearer_token_env_var\s*[:=]\s*[^n]|client_secret|api[_-]?token|password)/i), null);
assert.equal(JSON.stringify(planDirectMcp()).includes("bearer-token-env-var"), false);

// 4: managed update preserves disabled state and replaces only package-owned cache/config content.
runLifecycle("disable");
runLifecycle("update");
assert.equal(lifecycleState().status, "disabled");
assert.equal(lifecycleState().version, version);
assert.notEqual(lifecycleState().release_tree_sha256, previousReceipt.tree_sha256);
assert.equal(existsSync(join(profile, "plugins", "cache", CHATGPT_PLUGIN_SLUG, CHATGPT_PLUGIN_SLUG, "0.3.3")), false);
pluginRoot = join(profile, "plugins", "cache", CHATGPT_PLUGIN_SLUG, CHATGPT_PLUGIN_SLUG, version);
assert.deepEqual(skillNames(pluginRoot), [...CHATGPT_SKILLS].sort());

// 5: disable/enable changes the isolated selector only and preserves cache, selection, unrelated files.
const cache = snapshotTree(join(profile, "plugins", "cache"));
runLifecycle("enable");
assert.equal(lifecycleState().status, "enabled");
assert.deepEqual(snapshotTree(join(profile, "plugins", "cache")), cache);
assert.equal(snapshotTree(profile).includes("preserve these bytes"), true);

// 6: official plugin removal, then owned marketplace removal and state cleanup only.
runLifecycle("uninstall");
assert.equal(existsSync(join(profile, ".pipedrive-mcp-lifecycle", `${CHATGPT_PLUGIN_SLUG}.json`)), false);
assert.equal(existsSync(join(profile, "plugins", "cache", CHATGPT_PLUGIN_SLUG)), false);
assert.equal(snapshotTree(profile), unrelated);

// 7 and 8: unrelated bytes/modes survive every operation; reinstall reaches normalized equivalent state.
runLifecycle("install");
state = lifecycleState();
assert.equal(state.release_tree_sha256, receipt.tree_sha256);
assert.equal(snapshotTree(profile).includes("preserve these bytes"), true);
runLifecycle("uninstall");

// 9: injected MCP listings refuse before any registration subprocess.
assert.throws(() => planDirectMcp([{ name: CHATGPT_PLUGIN_SLUG, url: "https://other.example/mcp" }]), /direct_mcp_conflict_name/);
assert.throws(() => planDirectMcp([{ name: "other-mcp", url: CHATGPT_MCP_URL }]), /direct_mcp_conflict_url/);

// 10: injected diagnostics only; registration failure is not rewritten as offline.
for (const value of fixture.diagnostic.offline) assert.equal(classifyDirectMcpDiagnostic(value).code, "offline_mcp_diagnostic");
assert.equal(classifyDirectMcpDiagnostic(fixture.diagnostic.registration).code, "direct_mcp_registration_unaccepted");

// 11: local standalone skill copies are receipt-verified and selection is normalized; no connector is registered.
const standalone = join(repoRoot, "dist", "chatgpt-lifecycle", "standalone", "accept-subset");
rmSync(standalone, { recursive: true, force: true });
assert.deepEqual(stageStandaloneSkills({ artifactRoot: artifact, receipt, destination: standalone, lifecycleRoot: join(repoRoot, "dist", "chatgpt-lifecycle"), selection: ["pipedrive-next-action", "pipedrive-add-note", "pipedrive-add-note"] }), {
  skills: ["pipedrive-add-note", "pipedrive-next-action"], connector: "direct_mcp_external_gate_required",
});
assert.equal(normalizedSelection([...CHATGPT_SKILLS, ...CHATGPT_SKILLS]), "all");
const fullA = join(repoRoot, "dist", "chatgpt-lifecycle", "standalone", "full-a"); const fullB = join(repoRoot, "dist", "chatgpt-lifecycle", "standalone", "full-b"); rmSync(fullA, { recursive: true, force: true }); rmSync(fullB, { recursive: true, force: true });
for (const [destination, selection] of [[fullA, "all"], [fullB, [...CHATGPT_SKILLS].reverse().concat([...CHATGPT_SKILLS].reverse())]]) { stageStandaloneSkills({ artifactRoot: artifact, receipt, destination, lifecycleRoot: join(repoRoot, "dist", "chatgpt-lifecycle"), selection }); assert.deepEqual(standaloneSkillNames(destination), [...CHATGPT_SKILLS].sort()); for (const skill of CHATGPT_SKILLS) assert.equal(readFileSync(join(destination, skill, "SKILL.md"), "utf8"), readFileSync(join(artifact, "plugins", CHATGPT_PLUGIN_SLUG, "skills", skill, "SKILL.md"), "utf8")); }
assert.equal(snapshotTree(fullA), snapshotTree(fullB));
const standaloneOwned = exactTreeSnapshot(standalone);
assert.throws(() => stageStandaloneSkills({ artifactRoot: artifact, receipt, destination: standalone, lifecycleRoot: join(repoRoot, "dist", "chatgpt-lifecycle"), selection: "all", ownedDestinationSnapshot: standaloneOwned, testFailAfterReplace: true }), /lifecycle_test_failure:standalone_replace/);
assert.deepEqual(exactTreeSnapshot(standalone), standaloneOwned);
assert.equal(existsSync(`${standalone}.staging`) || existsSync(`${standalone}.backup`), false);
rmSync(standalone, { recursive: true, force: true });
rmSync(fullA, { recursive: true, force: true }); rmSync(fullB, { recursive: true, force: true });

assert.equal(snapshotTree(profile), unrelated);
assertNoResidue(profile);
const failurePoints = ["plugin-remove", "marketplace-remove", "marketplace-add", "plugin-add", "state-rename"];
for (const point of failurePoints) {
  const slug = `rollback-${point}`; resetManaged(slug); const before = exactTreeSnapshot(join(profilesRoot, slug));
  assert.throws(() => runLifecycleFor(slug, "update", { PIPEDRIVE_LIFECYCLE_FAIL_AT: point }), /lifecycle_test_failure/);
  assert.deepEqual(exactTreeSnapshot(join(profilesRoot, slug)), before); assertTransactionClean(slug);
  runLifecycleFor(slug, "update"); runLifecycleFor(slug, "uninstall");
}
const lateSlug = "rollback-transaction-finalize"; resetManaged(lateSlug); const lateBefore = exactTreeSnapshot(join(profilesRoot, lateSlug));
assert.throws(() => runLifecycleFor(lateSlug, "update", { PIPEDRIVE_LIFECYCLE_FAIL_AT: "transaction-finalize" }), /lifecycle_test_failure/);
assert.deepEqual(exactTreeSnapshot(join(profilesRoot, lateSlug)), lateBefore); assertTransactionClean(lateSlug); runLifecycleFor(lateSlug, "uninstall");

const drift = {};
for (const [name, mutate] of Object.entries({
  extra_file: (root) => writeFileSync(join(root, "plugins/cache/pipedrive-sandbox/pipedrive-sandbox/0.3.3/extra.txt"), "extra\n"),
  extra_version: (root) => mkdirSync(join(root, "plugins/cache/pipedrive-sandbox/pipedrive-sandbox/9.9.9"), { recursive: true }),
  mode_change: (root) => chmodSync(join(root, "plugins/cache/pipedrive-sandbox/pipedrive-sandbox/0.3.3/.app.json"), 0o600),
  symlink: (root) => symlinkSync(".app.json", join(root, "plugins/cache/pipedrive-sandbox/pipedrive-sandbox/0.3.3/link")),
})) {
  const slug = `drift-${name.replaceAll("_", "-")}`; resetManaged(slug); const root = join(profilesRoot, slug); mutate(root); const before = name === "symlink" ? null : exactTreeSnapshot(root);
  assert.throws(() => runLifecycleFor(slug, name === "extra_version" ? "update" : "uninstall"), /lifecycle_refused/); if (before) assert.deepEqual(exactTreeSnapshot(root), before); else assert.equal(lstatSync(join(root, "plugins/cache/pipedrive-sandbox/pipedrive-sandbox/0.3.3/link")).isSymbolicLink(), true); assertTransactionClean(slug); drift[name] = true;
}
for (const [kind, content, code] of [["name", "[mcp_servers.pipedrive-sandbox]\nurl = \"https://other.example/mcp\"\n", "mcp_name_conflict"], ["url", "[mcp_servers.other]\nurl = \"HTTPS://PIPEDRIVE-MCP-SANDBOX.PEZZOSLABS.COM:443/mcp/\"\n", "mcp_url_conflict"]]) {
  const slug = `conflict-${kind}`; const root = join(profilesRoot, slug); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true, mode: 0o700 }); applyProfileFixture(root, fixture); writeFileSync(join(root, "config.toml"), content); const before = exactTreeSnapshot(root);
  assert.throws(() => runLifecycleFor(slug, "install"), new RegExp(code)); assert.deepEqual(exactTreeSnapshot(root), before); assertTransactionClean(slug);
}
const standaloneForeign = join(repoRoot, "dist", "chatgpt-lifecycle", "standalone", "foreign-proof"); rmSync(standaloneForeign, { recursive: true, force: true }); mkdirSync(standaloneForeign, { recursive: true }); writeFileSync(join(standaloneForeign, "foreign.txt"), "foreign\n"); const standaloneForeignBefore = exactTreeSnapshot(standaloneForeign);
assert.throws(() => stageStandaloneSkills({ artifactRoot: artifact, receipt, destination: standaloneForeign, lifecycleRoot: join(repoRoot, "dist", "chatgpt-lifecycle"), selection: "all" }), /foreign_standalone_content/); assert.deepEqual(exactTreeSnapshot(standaloneForeign), standaloneForeignBefore);
const standaloneSymlink = join(repoRoot, "dist", "chatgpt-lifecycle", "standalone", "symlink-proof"); rmSync(standaloneSymlink, { recursive: true, force: true }); symlinkSync("foreign-proof", standaloneSymlink); assert.throws(() => stageStandaloneSkills({ artifactRoot: artifact, receipt, destination: join(standaloneSymlink, "nested"), lifecycleRoot: join(repoRoot, "dist", "chatgpt-lifecycle"), selection: "all" }), /symlink_escape/);
const configAdditionSlug = "config-post-addition"; const configAdditionRoot = join(profilesRoot, configAdditionSlug); rmSync(configAdditionRoot, { recursive: true, force: true }); mkdirSync(configAdditionRoot, { recursive: true, mode: 0o700 }); const configAdditionBaseline = snapshotWithoutConfig(configAdditionRoot); runLifecycleFor(configAdditionSlug, "install", {}, ["--release=previous"]); const configAddition = "\n[unrelated]\nvalue = \"preserve\"\n"; const configAdditionPath = join(configAdditionRoot, "config.toml"); writeFileSync(configAdditionPath, `${readFileSync(configAdditionPath, "utf8")}${configAddition}`); chmodSync(configAdditionPath, 0o600); runLifecycleFor(configAdditionSlug, "uninstall"); assert.equal(readFileSync(configAdditionPath, "utf8"), configAddition); assert.equal((lstatSync(configAdditionPath).mode & 0o777).toString(8), "600"); assertNoResidue(configAdditionRoot); assert.deepEqual(snapshotWithoutConfig(configAdditionRoot), configAdditionBaseline); assertTransactionClean(configAdditionSlug);
const configDrift = {};
for (const [name, needle] of [["plugin_config", "enabled = true"], ["marketplace_config", "source_type = \"foreign\""]]) { const slug = `drift-${name.replaceAll("_", "-")}`; resetManaged(slug); const root = join(profilesRoot, slug); const config = join(root, "config.toml"); writeFileSync(config, readFileSync(config, "utf8").replace(name === "plugin_config" ? "enabled = false" : "source_type = \"local\"", needle)); const before = exactTreeSnapshot(root); assert.throws(() => runLifecycleFor(slug, "update"), /managed_content_modified/); assert.deepEqual(exactTreeSnapshot(root), before); assertTransactionClean(slug); configDrift[name] = true; }
const currentResult = { format: "pipedrive-chatgpt-lifecycle-results-v1", schema_version: 1, codex_cli_version: execFileSync("codex", ["--version"], { cwd: repoRoot, encoding: "utf8" }).trim(), profile_scope: "generated-only", release: { current_version: version, current_tree_sha256: receipt.tree_sha256, previous_fixture_kind: "synthetic_previous_release_fixture", previous_fixture_version: "0.3.3", previous_fixture_tree_sha256: previousReceipt.tree_sha256 }, matrix: Array.from({ length: 11 }, (_, index) => ({ id: index + 1, status: "passed" })), update: { from_version: "0.3.3", to_version: version, enabled_state_preserved: true, old_version_residue: false }, rollback: { failure_points: failurePoints, exact_restore: true, transaction_commit_exact_restore: true }, drift: { extra_file_refused: drift.extra_file, extra_version_refused: drift.extra_version, mode_change_refused: drift.mode_change, symlink_refused: drift.symlink, exact_immutability: true }, standalone: { selective_and_full_deterministic: true, foreign_content_refused: true, symlink_refused: true, replacement_rollback_exact: true, connector_status: "direct_mcp_external_gate_required" }, residue: { final_profile_equals_baseline: true, transaction_residue: false }, direct_mcp: { status: "planned_fixture_only_external_b8", executed_commands: [] } };
currentResult.drift.plugin_config_refused = configDrift.plugin_config; currentResult.drift.marketplace_config_refused = configDrift.marketplace_config;
writeFileSync(`${resultsPath}.staging`, `${JSON.stringify(currentResult, null, 2)}\n`, { mode: 0o644 }); chmodSync(`${resultsPath}.staging`, 0o644); renameSync(`${resultsPath}.staging`, resultsPath);
console.log("primary_plugin_lifecycle: passed_actual_isolated");
console.log("direct_mcp_fallback: planned_fixture_only_external_b8");

function runLifecycle(action, extra = []) { return runLifecycleFor(scenario, action, {}, extra); }
function runLifecycleFor(slug, action, env = {}, extra = []) {
  const args = ["scripts/chatgpt-lifecycle.mjs", action, slug, ...extra];
  assert.equal(args.slice(1, 3).join(" ").startsWith("mcp "), false, "acceptance must not spawn an MCP command");
  return execFileSync("node", args, { cwd: repoRoot, stdio: "pipe", env: { ...process.env, ...env } });
}
function resetManaged(slug) { const root = join(profilesRoot, slug); rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true, mode: 0o700 }); applyProfileFixture(root, fixture); runLifecycleFor(slug, "install", {}, ["--release=previous"]); runLifecycleFor(slug, "disable"); }
function assertTransactionClean(slug) { assert.equal(existsSync(join(repoRoot, "dist/chatgpt-lifecycle/locks", `${slug}.lock`)), false); assert.equal(existsSync(join(repoRoot, "dist/chatgpt-lifecycle/transactions", `${slug}.backup`)), false); }

function lifecycleState() {
  return JSON.parse(readFileSync(join(profile, ".pipedrive-mcp-lifecycle", `${CHATGPT_PLUGIN_SLUG}.json`), "utf8"));
}

function skillNames(root) {
  return [...new Set(CHATGPT_SKILLS.filter((skill) => existsSync(join(root, "skills", skill, "SKILL.md"))))].sort();
}

function standaloneSkillNames(root) {
  return [...new Set(CHATGPT_SKILLS.filter((skill) => existsSync(join(root, skill, "SKILL.md"))))].sort();
}

function snapshot(root, paths) {
  return paths.map((path) => {
    const absolute = join(root, path);
    return [path, (lstatSync(absolute).mode & 0o777).toString(8).padStart(4, "0"), readFileSync(absolute, "utf8")];
  });
}

function snapshotTree(root) {
  return existsSync(root) ? readTreeText(root) : "";
}

function snapshotWithoutConfig(root) {
  return exactTreeSnapshot(root).filter((entry) => entry.path !== "config.toml");
}

function readTreeText(root) {
  if (lstatSync(root).isFile()) return readFileSync(root, "utf8");
  const entries = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name);
      if (lstatSync(file).isDirectory()) visit(file);
      else entries.push(`${relative(root, file)}\0${(lstatSync(file).mode & 0o777).toString(8)}\0${readFileSync(file, "utf8")}`);
    }
  };
  visit(root);
  return entries.sort().join("\n");
}

function assertNoResidue(root) {
  const paths = [
    join(root, ".pipedrive-mcp-lifecycle", `${CHATGPT_PLUGIN_SLUG}.json`),
    join(root, ".pipedrive-mcp-lifecycle", `${CHATGPT_PLUGIN_SLUG}.lock`),
    join(root, ".pipedrive-mcp-lifecycle", `${CHATGPT_PLUGIN_SLUG}.json.staging`),
    join(root, "plugins", "cache", CHATGPT_PLUGIN_SLUG),
  ];
  for (const path of paths) assert.equal(existsSync(path), false, `owned lifecycle residue: ${relative(root, path)}`);
  const config = existsSync(join(root, "config.toml")) ? readFileSync(join(root, "config.toml"), "utf8") : "";
  assert.equal(config.includes(`[plugins."${LIFECYCLE_SELECTOR}"]`), false);
  assert.equal(config.includes(`[marketplaces.${CHATGPT_PLUGIN_SLUG}]`), false);
  assert.equal(/oauth|token|secret/i.test(config), false);
}
