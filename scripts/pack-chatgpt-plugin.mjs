import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { assertSafeTextTree, walk } from "./lib/artifact-safety.mjs";
import {
  CHATGPT_PLUGIN_DESCRIPTION,
  CHATGPT_PLUGIN_NAME,
  CHATGPT_PLUGIN_SLUG,
  CHATGPT_SKILLS,
  expectedAppManifest,
  loadChatgptPluginSource,
} from "./lib/chatgpt-plugin-contract.mjs";

const repoRoot = process.cwd();
const sourcePath = join(repoRoot, "plugin", "chatgpt", "plugin-source.json");
const packageVersion = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
const distRoot = resolve(repoRoot, "dist", "chatgpt-plugin");
const skillsRoot = testSkillsRoot(process.env.PIPEDRIVE_TEST_CHATGPT_SKILLS_ROOT) ?? join(repoRoot, "plugin", "claude", "skills");
const source = loadChatgptPluginSource(sourcePath);
const artifactName = `${CHATGPT_PLUGIN_SLUG}-${packageVersion}`;
const artifactRoot = outputDirectory(process.argv.slice(2));
const receiptPath = `${artifactRoot}.sha256.json`;
const stagingRoot = `${artifactRoot}.staging`;
const stagingReceiptPath = `${receiptPath}.staging`;
const backupRoot = `${artifactRoot}.backup`;
const backupReceiptPath = `${receiptPath}.backup`;
const expectedFiles = [
  ".agents/plugins/marketplace.json",
  `plugins/${CHATGPT_PLUGIN_SLUG}/.app.json`,
  `plugins/${CHATGPT_PLUGIN_SLUG}/.codex-plugin/plugin.json`,
  ...CHATGPT_SKILLS.map((skill) => `plugins/${CHATGPT_PLUGIN_SLUG}/skills/${skill}/SKILL.md`),
].sort();

prepareOutputPaths();
assertCanonicalSkillSet();
mkdirSync(stagingRoot, { recursive: true });

try {
  const pluginRoot = join(stagingRoot, "plugins", CHATGPT_PLUGIN_SLUG);
  writeJson(join(stagingRoot, ".agents", "plugins", "marketplace.json"), {
    name: source.marketplace.name,
    interface: { displayName: CHATGPT_PLUGIN_NAME },
    plugins: [{
      name: CHATGPT_PLUGIN_SLUG,
      source: { source: "local", path: `./plugins/${CHATGPT_PLUGIN_SLUG}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Business & Operations",
    }],
  });
  writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), {
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
  });
  writeJson(join(pluginRoot, ".app.json"), expectedAppManifest(source));

  for (const skill of CHATGPT_SKILLS) {
    const skillPath = join(skillsRoot, skill, "SKILL.md");
    if (!existsSync(skillPath)) {
      throw new Error(`Missing canonical ChatGPT skill: ${skill}`);
    }
    const target = join(pluginRoot, "skills", skill, "SKILL.md");
    mkdirSync(dirname(target), { recursive: true });
    cpSync(skillPath, target, { dereference: false });
    chmodSync(target, 0o644);
  }

  assertSafeTextTree(stagingRoot, { allowedFiles: expectedFiles });
  assertArtifact(stagingRoot);
  writeJson(stagingReceiptPath, receipt(stagingRoot));
  replaceArtifactPair();
  console.log(`ChatGPT plugin artifact staged at ${artifactRoot}`);
} catch (error) {
  cleanTemporaryPaths();
  throw error;
}

function outputDirectory(args) {
  if (args.length === 0) {
    return join(distRoot, artifactName);
  }
  if (args.length !== 2 || args[0] !== "--out-dir" || !args[1]) {
    throw new Error("Usage: node scripts/pack-chatgpt-plugin.mjs [--out-dir <dist/chatgpt-plugin/subdirectory>]");
  }
  const target = resolve(repoRoot, args[1]);
  if (target === distRoot || !target.startsWith(`${distRoot}/`)) {
    throw new Error("--out-dir must stay under dist/chatgpt-plugin");
  }
  return target;
}

function testSkillsRoot(value) {
  if (!value) {
    return null;
  }
  const root = resolve(repoRoot, value);
  if (!root.startsWith(`${distRoot}/`)) {
    throw new Error("PIPEDRIVE_TEST_CHATGPT_SKILLS_ROOT must stay under dist/chatgpt-plugin");
  }
  return root;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  chmodSync(path, 0o644);
}

function assertCanonicalSkillSet() {
  const workflowDirectories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expectedDirectories = [...CHATGPT_SKILLS].sort();
  if (JSON.stringify(workflowDirectories) !== JSON.stringify(expectedDirectories)) {
    throw new Error("Canonical workflow directories must be exactly the approved seven skills");
  }
  for (const skill of CHATGPT_SKILLS) {
    if (!existsSync(join(skillsRoot, skill, "SKILL.md"))) {
      throw new Error(`Canonical ChatGPT workflow is missing SKILL.md: ${skill}`);
    }
  }
}

function replaceArtifactPair() {
  let installedArtifact = false;
  let installedReceipt = false;
  try {
    moveAside(artifactRoot, backupRoot);
    moveAside(receiptPath, backupReceiptPath);
    renameSync(stagingRoot, artifactRoot);
    installedArtifact = true;
    if (process.env.PIPEDRIVE_TEST_FAIL_CHATGPT_PLUGIN_AFTER_ARTIFACT_INSTALL === "1") {
      throw new Error("Test-only ChatGPT plugin failure after artifact installation");
    }
    renameSync(stagingReceiptPath, receiptPath);
    installedReceipt = true;
    cleanBackups();
  } catch (error) {
    if (installedArtifact) {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
    if (installedReceipt) {
      rmSync(receiptPath, { force: true });
    }
    restoreBackup(backupRoot, artifactRoot);
    restoreBackup(backupReceiptPath, receiptPath);
    cleanTemporaryPaths();
    throw error;
  }
}

function moveAside(source, backup) {
  if (existsSync(source)) {
    renameSync(source, backup);
  }
}

function restoreBackup(backup, target) {
  if (existsSync(backup)) {
    renameSync(backup, target);
  }
}

function cleanBackups() {
  rmSync(backupRoot, { recursive: true, force: true });
  rmSync(backupReceiptPath, { force: true });
}

function cleanTemporaryPaths() {
  rmSync(stagingRoot, { recursive: true, force: true });
  rmSync(stagingReceiptPath, { force: true });
  cleanBackups();
}

function prepareOutputPaths() {
  rmSync(stagingRoot, { recursive: true, force: true });
  rmSync(stagingReceiptPath, { force: true });
  if (!existsSync(artifactRoot) && existsSync(backupRoot)) {
    renameSync(backupRoot, artifactRoot);
  }
  if (!existsSync(receiptPath) && existsSync(backupReceiptPath)) {
    renameSync(backupReceiptPath, receiptPath);
  }
  cleanBackups();
}

function assertArtifact(root) {
  const files = [...walk(root)].map((file) => relative(root, file)).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error("ChatGPT plugin artifact must contain exactly its 10 approved files");
  }
  const app = JSON.parse(readFileSync(join(root, "plugins", CHATGPT_PLUGIN_SLUG, ".app.json"), "utf8"));
  if (JSON.stringify(app) !== JSON.stringify(expectedAppManifest(source))) {
    throw new Error("ChatGPT plugin .app.json does not match the required app contract");
  }
}

function receipt(root) {
  const files = [...walk(root)]
    .map((file) => ({
      path: relative(root, file),
      mode: (lstatSync(file).mode & 0o777).toString(8).padStart(4, "0"),
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const tree = files.map((file) => `${file.path}\0${file.mode}\0${file.sha256}\n`).join("");
  return {
    format: "pipedrive-chatgpt-plugin-receipt-v1",
    artifact: artifactName,
    files,
    tree_sha256: createHash("sha256").update(tree).digest("hex"),
  };
}
