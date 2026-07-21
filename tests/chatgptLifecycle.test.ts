import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  classifyDirectMcpDiagnostic,
  normalizedSelection,
  planDirectMcp,
  stageStandaloneSkills,
} from "../scripts/lib/chatgpt-lifecycle-contract.mjs";
import { CHATGPT_MCP_URL, CHATGPT_PLUGIN_SLUG, CHATGPT_SKILLS } from "../scripts/lib/chatgpt-plugin-contract.mjs";

const repoRoot = process.cwd();

test("direct MCP fallback is a secret-free plan and rejects registration before any subprocess", () => {
  assert.deepEqual(planDirectMcp(), {
    command: ["codex", "mcp", "add", "pipedrive-sandbox", "--url", "https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp"],
    name: CHATGPT_PLUGIN_SLUG,
    transport: "streamable-http",
    url: CHATGPT_MCP_URL,
    bearer_token_env_var: null,
    external_gate: "B8",
    status: "direct_mcp_external_gate_required",
  });
  assert.throws(() => planDirectMcp([{ name: CHATGPT_PLUGIN_SLUG, url: "https://other.example/mcp" }]), /direct_mcp_conflict_name/);
  assert.throws(() => planDirectMcp([{ name: "other", url: CHATGPT_MCP_URL }]), /direct_mcp_conflict_url/);
  assert.equal(classifyDirectMcpDiagnostic("invalid_client_metadata").code, "direct_mcp_registration_unaccepted");
  assert.equal(classifyDirectMcpDiagnostic("DNS lookup timeout").code, "offline_mcp_diagnostic");
  assert.equal(normalizedSelection([CHATGPT_SKILLS[1], CHATGPT_SKILLS[1], CHATGPT_SKILLS[0]]).join(","), `${CHATGPT_SKILLS[0]},${CHATGPT_SKILLS[1]}`);
  assert.equal(normalizedSelection([...CHATGPT_SKILLS, ...CHATGPT_SKILLS]), "all");
  const lifecycleSource = readFileSync(join(repoRoot, "scripts", "chatgpt-lifecycle.mjs"), "utf8");
  assert.equal(lifecycleSource.includes('runCodex(profile, ["mcp"'), false);
  assert.equal(typeof stageStandaloneSkills, "function");
  const profile = join(repoRoot, "dist", "chatgpt-lifecycle", "profiles", "direct-reject");
  rmSync(profile, { recursive: true, force: true });
  execFileSync("npm", ["run", "pack:chatgpt-lifecycle"], { cwd: repoRoot, stdio: "pipe" });
  assert.throws(
    () => execFileSync("node", ["scripts/chatgpt-lifecycle.mjs", "install", "direct-reject", "--mode=technical-fallback"], { cwd: repoRoot, encoding: "utf8" }),
    /direct_mcp_external_gate_required/,
  );
  assert.equal(existsSync(join(profile, "config.toml")), false);
  rmSync(profile, { recursive: true, force: true });
});

test("B3 acceptance exercises only the isolated local plugin lifecycle", { timeout: 180_000 }, () => {
  const output = execFileSync("npm", ["run", "accept:chatgpt-lifecycle"], { cwd: repoRoot, encoding: "utf8" });
  assert.match(output, /primary_plugin_lifecycle: passed_actual_isolated/);
  assert.match(output, /direct_mcp_fallback: planned_fixture_only_external_b8/);
  assert.equal(output.includes("mcp add"), false);
  const resultsPath = join(repoRoot, "dist", "chatgpt-lifecycle", "results.json");
  const results = JSON.parse(readFileSync(resultsPath, "utf8"));
  assert.equal(results.format, "pipedrive-chatgpt-lifecycle-results-v1");
  assert.equal(results.codex_cli_version, "codex-cli 0.144.1");
  assert.deepEqual(results.matrix.map((entry: { id: number; status: string }) => entry.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(results.matrix.every((entry: { status: string }) => entry.status === "passed"), true);
  assert.deepEqual(results.rollback.failure_points, ["plugin-remove", "marketplace-remove", "marketplace-add", "plugin-add", "state-rename"]);
  assert.equal(results.rollback.exact_restore, true);
  assert.equal(results.drift.extra_file_refused && results.drift.extra_version_refused && results.drift.mode_change_refused && results.drift.symlink_refused && results.drift.plugin_config_refused && results.drift.marketplace_config_refused, true);
  assert.deepEqual(results.direct_mcp, { status: "planned_fixture_only_external_b8", executed_commands: [] });
  assert.deepEqual(results.standalone, { selective_and_full_deterministic: true, foreign_content_refused: true, symlink_refused: true, replacement_rollback_exact: true, connector_status: "direct_mcp_external_gate_required" });
  assert.equal(existsSync(`${resultsPath}.staging`), false);
});
