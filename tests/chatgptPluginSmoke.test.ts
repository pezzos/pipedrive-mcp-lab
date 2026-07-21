import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { assertSafeTextTree, walk } from "../scripts/lib/artifact-safety.mjs";
import {
  CHATGPT_APP_ID,
  CHATGPT_REMOTE_PLUGIN_ID,
  CHATGPT_PLUGIN_DESCRIPTION,
  CHATGPT_PLUGIN_NAME,
  CHATGPT_MCP_URL,
  CHATGPT_PLUGIN_SLUG,
  CHATGPT_SKILLS,
  expectedAppManifest,
  loadChatgptPluginSource,
} from "../scripts/lib/chatgpt-plugin-contract.mjs";

const repoRoot = process.cwd();
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const artifactRoot = join(repoRoot, "dist", "chatgpt-plugin", `${CHATGPT_PLUGIN_SLUG}-${packageVersion}`);
const receiptPath = `${artifactRoot}.sha256.json`;
const expectedFiles = [
  ".agents/plugins/marketplace.json",
  `plugins/${CHATGPT_PLUGIN_SLUG}/.app.json`,
  `plugins/${CHATGPT_PLUGIN_SLUG}/.codex-plugin/plugin.json`,
  ...CHATGPT_SKILLS.map((skill) => `plugins/${CHATGPT_PLUGIN_SLUG}/skills/${skill}/SKILL.md`),
].sort();

test("ChatGPT package is deterministic, complete, and isolated", { timeout: 180_000 }, () => {
  execFileSync("npm", ["run", "pack:chatgpt-plugin"], { cwd: repoRoot, stdio: "pipe" });
  const firstReceipt = readFileSync(receiptPath, "utf8");
  execFileSync("npm", ["run", "pack:chatgpt-plugin"], { cwd: repoRoot, stdio: "pipe" });
  assert.equal(readFileSync(receiptPath, "utf8"), firstReceipt);

  const source = loadChatgptPluginSource(join(repoRoot, "plugin", "chatgpt", "plugin-source.json"));
  assert.equal(source.name, CHATGPT_PLUGIN_NAME);
  assert.equal(source.description, CHATGPT_PLUGIN_DESCRIPTION);
  assert.equal(source.app_id, CHATGPT_APP_ID);
  assert.equal(source.remote_plugin_id, CHATGPT_REMOTE_PLUGIN_ID);
  assert.equal(CHATGPT_MCP_URL, "https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp");
  assert.equal(source.mcp_url, CHATGPT_MCP_URL);
  assert.deepEqual(source.listing.safety_labels, ["Private sandbox", "Read-only by default"]);
  assert.equal(source.listing.starter_prompts.length, 3);

  const files = [...walk(artifactRoot)].map((file) => relative(artifactRoot, file)).sort();
  assert.deepEqual(files, expectedFiles);
  assert.doesNotThrow(() => assertSafeTextTree(artifactRoot, { allowedFiles: expectedFiles }));

  const pluginRoot = join(artifactRoot, "plugins", CHATGPT_PLUGIN_SLUG);
  const plugin = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assert.deepEqual(plugin, expectedPluginManifest(source));
  assert.deepEqual(Object.keys(plugin), ["name", "version", "description", "author", "license", "keywords", "skills", "apps", "interface"]);
  assert.deepEqual(Object.keys(plugin.interface), ["displayName", "shortDescription", "longDescription", "developerName", "category", "capabilities", "defaultPrompt", "screenshots"]);
  assert.equal(
    readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
    `${JSON.stringify(expectedPluginManifest(source), null, 2)}\n`,
  );
  const marketplace = JSON.parse(readFileSync(join(artifactRoot, ".agents", "plugins", "marketplace.json"), "utf8"));
  assert.deepEqual(marketplace, expectedMarketplaceManifest());
  assert.deepEqual(Object.keys(marketplace), ["name", "interface", "plugins"]);
  assert.deepEqual(Object.keys(marketplace.plugins[0]), ["name", "source", "policy", "category"]);
  assert.equal(
    readFileSync(join(artifactRoot, ".agents", "plugins", "marketplace.json"), "utf8"),
    `${JSON.stringify(expectedMarketplaceManifest(), null, 2)}\n`,
  );
  assert.equal(existsSync(join(pluginRoot, ".mcp.json")), false);
  assert.equal(JSON.stringify(plugin).includes("mcpServers"), false);
  assert.deepEqual(JSON.parse(readFileSync(join(pluginRoot, ".app.json"), "utf8")), expectedAppManifest(source));
  assert.equal(readFileSync(join(pluginRoot, ".app.json"), "utf8").includes(CHATGPT_APP_ID), true);
  assert.equal(readFileSync(join(pluginRoot, ".app.json"), "utf8").includes(CHATGPT_REMOTE_PLUGIN_ID), false);
  const artifactText = files.map((file) => readFileSync(join(artifactRoot, file), "utf8")).join("\n");
  assert.equal(artifactText.includes(CHATGPT_MCP_URL), false);
  assert.equal(artifactText.includes("mcpServers"), false);
  assert.equal(artifactText.includes(".mcp.json"), false);

  for (const skill of CHATGPT_SKILLS) {
    assert.equal(
      readFileSync(join(pluginRoot, "skills", skill, "SKILL.md"), "utf8"),
      readFileSync(join(repoRoot, "plugin", "claude", "skills", skill, "SKILL.md"), "utf8"),
      `${skill} must be byte-identical to the canonical workflow`,
    );
  }

  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  assert.deepEqual(receipt.files.map((file: { path: string }) => file.path), expectedFiles);
  assert.equal(receipt.files.every((file: { mode: string }) => file.mode === "0644"), true);
  const tree = receipt.files.map((file: { path: string; mode: string; sha256: string }) => `${file.path}\0${file.mode}\0${file.sha256}\n`).join("");
  assert.equal(receipt.tree_sha256, createHash("sha256").update(tree).digest("hex"));
  assert.equal(JSON.stringify(receipt).includes(repoRoot), false);
  assert.equal(JSON.stringify(receipt).match(/(?:timestamp|hostname|git)/i), null);
});

test("ChatGPT package is byte- and mode-identical across isolated allowed output roots", () => {
  const outputA = join(repoRoot, "dist", "chatgpt-plugin", "isolated-a");
  const outputB = join(repoRoot, "dist", "chatgpt-plugin", "isolated-b");
  try {
    execFileSync("node", ["scripts/pack-chatgpt-plugin.mjs", "--out-dir", outputA], { cwd: repoRoot, stdio: "pipe" });
    execFileSync("node", ["scripts/pack-chatgpt-plugin.mjs", "--out-dir", outputB], { cwd: repoRoot, stdio: "pipe" });
    assert.deepEqual(artifactSnapshot(outputA), artifactSnapshot(outputB));
    assert.equal(readFileSync(`${outputA}.sha256.json`, "utf8"), readFileSync(`${outputB}.sha256.json`, "utf8"));
    assert.equal(
      JSON.parse(readFileSync(`${outputA}.sha256.json`, "utf8")).tree_sha256,
      JSON.parse(readFileSync(`${outputB}.sha256.json`, "utf8")).tree_sha256,
    );
  } finally {
    for (const output of [outputA, outputB]) {
      rmSync(output, { recursive: true, force: true });
      rmSync(`${output}.sha256.json`, { force: true });
      rmSync(`${output}.staging`, { recursive: true, force: true });
      rmSync(`${output}.sha256.json.staging`, { force: true });
      rmSync(`${output}.backup`, { recursive: true, force: true });
      rmSync(`${output}.sha256.json.backup`, { force: true });
    }
  }
});

test("ChatGPT packer restores the previous artifact and receipt as one pair after a replacement failure", () => {
  execFileSync("npm", ["run", "pack:chatgpt-plugin"], { cwd: repoRoot, stdio: "pipe" });
  const priorArtifact = artifactSnapshot(artifactRoot);
  const priorReceipt = readFileSync(receiptPath, "utf8");

  assert.throws(
    () => execFileSync("npm", ["run", "pack:chatgpt-plugin"], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, PIPEDRIVE_TEST_FAIL_CHATGPT_PLUGIN_AFTER_ARTIFACT_INSTALL: "1" },
    }),
    /Command failed/,
  );

  assert.deepEqual(artifactSnapshot(artifactRoot), priorArtifact);
  assert.equal(readFileSync(receiptPath, "utf8"), priorReceipt);
  assert.equal(existsSync(`${artifactRoot}.staging`), false);
  assert.equal(existsSync(`${receiptPath}.staging`), false);
  assert.equal(existsSync(`${artifactRoot}.backup`), false);
  assert.equal(existsSync(`${receiptPath}.backup`), false);
});

test("ChatGPT packer rejects outputs outside its ignored distribution root", () => {
  const unsafeOutput = join(repoRoot, "dist", "outside-chatgpt-plugin");
  try {
    assert.throws(
      () => execFileSync("node", ["scripts/pack-chatgpt-plugin.mjs", "--out-dir", unsafeOutput], { cwd: repoRoot, stdio: "pipe" }),
      /Command failed/,
    );
  } finally {
    rmSync(unsafeOutput, { recursive: true, force: true });
  }
});

test("ChatGPT packer rejects extra or incomplete immediate canonical workflows", () => {
  const fixtureRoot = join(repoRoot, "dist", "chatgpt-plugin", "canonical-set-test");
  const skillsRoot = join(fixtureRoot, "skills");
  const outputRoot = join(fixtureRoot, "output");
  const commandEnvironment = { ...process.env, PIPEDRIVE_TEST_CHATGPT_SKILLS_ROOT: skillsRoot };
  try {
    cpSync(join(repoRoot, "plugin", "claude", "skills"), skillsRoot, { recursive: true, dereference: false });
    const unexpectedSkill = join(skillsRoot, "pipedrive-unapproved-pack-test");
    mkdirSync(unexpectedSkill, { recursive: true });
    writeFileSync(join(unexpectedSkill, "SKILL.md"), "# temporary test workflow\n", "utf8");
    assert.throws(
      () => execFileSync("node", ["scripts/pack-chatgpt-plugin.mjs", "--out-dir", outputRoot], { cwd: repoRoot, stdio: "pipe", env: commandEnvironment }),
      /Command failed/,
    );
    rmSync(unexpectedSkill, { recursive: true, force: true });

    const canonicalSkill = join(skillsRoot, CHATGPT_SKILLS[0], "SKILL.md");
    const hiddenSkill = `${canonicalSkill}.pack-test-backup`;
    renameSync(canonicalSkill, hiddenSkill);
    try {
      assert.throws(
        () => execFileSync("node", ["scripts/pack-chatgpt-plugin.mjs", "--out-dir", outputRoot], { cwd: repoRoot, stdio: "pipe", env: commandEnvironment }),
        /Command failed/,
      );
    } finally {
      renameSync(hiddenSkill, canonicalSkill);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    rmSync(`${outputRoot}.sha256.json`, { force: true });
  }
});

function artifactSnapshot(root: string) {
  return [...walk(root)]
    .map((file) => [relative(root, file), (lstatSync(file).mode & 0o777).toString(8).padStart(4, "0"), readFileSync(file, "utf8")])
    .sort(([left], [right]) => left.localeCompare(right));
}

function expectedPluginManifest(source: ReturnType<typeof loadChatgptPluginSource>) {
  return {
    name: CHATGPT_PLUGIN_SLUG,
    version: packageVersion,
    description: CHATGPT_PLUGIN_DESCRIPTION,
    author: { name: "Pezzos Labs" },
    license: "MIT",
    keywords: ["pipedrive", "crm", "sales", "sandbox"],
    skills: "./skills/",
    apps: "./.app.json",
    interface: {
      displayName: CHATGPT_PLUGIN_NAME,
      shortDescription: "Private Pipedrive sandbox, read-only by default",
      longDescription: "Private sandbox for seven guided Pipedrive workflows. Read-only by default. Changes require a dry-run preview and explicit approval.",
      developerName: "Pezzos Labs",
      category: "Business & Operations",
      capabilities: [],
      defaultPrompt: source.listing.starter_prompts,
      screenshots: [],
    },
  };
}

function expectedMarketplaceManifest() {
  return {
    name: CHATGPT_PLUGIN_SLUG,
    interface: { displayName: CHATGPT_PLUGIN_NAME },
    plugins: [{
      name: CHATGPT_PLUGIN_SLUG,
      source: { source: "local", path: `./plugins/${CHATGPT_PLUGIN_SLUG}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Business & Operations",
    }],
  };
}
