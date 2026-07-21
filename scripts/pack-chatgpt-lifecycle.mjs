import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertArtifactMatchesReceipt, lifecycleRelease, loadReceipt, receiptForTree, releasePath } from "./lib/chatgpt-lifecycle-contract.mjs";
import { CHATGPT_PLUGIN_SLUG } from "./lib/chatgpt-plugin-contract.mjs";

const repoRoot = process.cwd();
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const artifactRoot = resolve(repoRoot, "dist", "chatgpt-plugin", `${CHATGPT_PLUGIN_SLUG}-${version}`);
const receiptPath = `${artifactRoot}.sha256.json`;
const output = releasePath(repoRoot);
const staging = `${output}.staging`;
const backup = `${output}.backup`;

if (!existsSync(artifactRoot) || !existsSync(receiptPath)) {
  throw new Error("Build B2 first with npm run pack:chatgpt-plugin");
}
const receipt = loadReceipt(receiptPath);
assertArtifactMatchesReceipt(artifactRoot, receipt);
mkdirSync(resolve(repoRoot, "dist", "chatgpt-lifecycle"), { recursive: true, mode: 0o755 });
rmSync(staging, { force: true });
writeFileSync(staging, `${JSON.stringify(lifecycleRelease({ version, receipt }), null, 2)}\n`, { mode: 0o644 });
chmodSync(staging, 0o644);
try {
  if (existsSync(output)) renameSync(output, backup);
  renameSync(staging, output);
  rmSync(backup, { force: true });
} catch (error) {
  rmSync(output, { force: true });
  if (existsSync(backup)) renameSync(backup, output);
  rmSync(staging, { force: true });
  throw error;
}
console.log(`ChatGPT lifecycle release staged at ${output}`);

const fixtureRoot = resolve(repoRoot, "dist", "chatgpt-lifecycle", "fixtures", "previous-release");
const previousArtifact = join(fixtureRoot, `${CHATGPT_PLUGIN_SLUG}-0.3.3`);
const previousReceiptPath = `${previousArtifact}.sha256.json`;
const previousReleasePath = join(fixtureRoot, "pipedrive-sandbox-release.json");
rmSync(fixtureRoot, { recursive: true, force: true });
mkdirSync(fixtureRoot, { recursive: true, mode: 0o755 });
cpSync(artifactRoot, previousArtifact, { recursive: true, dereference: false });
const pluginPath = join(previousArtifact, "plugins", CHATGPT_PLUGIN_SLUG, ".codex-plugin", "plugin.json");
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
plugin.version = "0.3.3";
writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`, { mode: 0o644 });
chmodSync(pluginPath, 0o644);
const previousReceipt = receiptForTree(previousArtifact, `${CHATGPT_PLUGIN_SLUG}-0.3.3`);
writeFileSync(previousReceiptPath, `${JSON.stringify(previousReceipt, null, 2)}\n`, { mode: 0o644 });
const previousRelease = lifecycleRelease({ version: "0.3.3", receipt: previousReceipt });
previousRelease.artifact.relative_path = `./${CHATGPT_PLUGIN_SLUG}-0.3.3`;
writeFileSync(previousReleasePath, `${JSON.stringify({ ...previousRelease, synthetic_previous_release_fixture: true }, null, 2)}\n`, { mode: 0o644 });
chmodSync(previousReceiptPath, 0o644);
chmodSync(previousReleasePath, 0o644);
console.log(`Synthetic previous release fixture staged at ${fixtureRoot}`);
