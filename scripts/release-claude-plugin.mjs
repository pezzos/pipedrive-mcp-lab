import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { walk } from "./lib/artifact-safety.mjs";

const repoRoot = process.cwd();
const packageJson = readJson(join(repoRoot, "package.json"));
const args = parseArgs(process.argv.slice(2));
const version = args.version ?? packageJson.version;
const publish = Boolean(args.publish);
const skipCheck = Boolean(args["skip-check"]);
const skipRemoteVerify = Boolean(args["skip-remote-verify"]);
const skipReleaseAssets = Boolean(args["skip-release-assets"]);
const requestedDistributionRepo = args["distribution-repo"] ?? process.env.PIPEDRIVE_MCP_PLUGIN_REPO;
const distributionGitUrl =
  args["distribution-git-url"] ??
  process.env.PIPEDRIVE_MCP_PLUGIN_GIT_URL ??
  "https://github.com/pezzos/pipedrive-mcp-claude-plugin.git";
const distributionGitBranch = args["distribution-git-branch"] ?? process.env.PIPEDRIVE_MCP_PLUGIN_GIT_BRANCH ?? "main";
const releaseRepo =
  args["release-repo"] ?? process.env.PIPEDRIVE_MCP_PLUGIN_RELEASE_REPO ?? "pezzos/pipedrive-mcp-claude-plugin";
const releaseTag = args["release-tag"] ?? `v${version}`;
const releaseDownloadBase =
  args["release-download-base"] ?? `https://github.com/${releaseRepo}/releases/download/${releaseTag}`;
const latestReleaseDownloadBase =
  args["latest-release-download-base"] ?? `https://github.com/${releaseRepo}/releases/latest/download`;

const pluginArtifactRoot = join(repoRoot, "dist", "claude-plugin", "pipedrive-mcp");
const standaloneSkillsRoot = join(repoRoot, "dist", "claude-skills");
const pluginServerPath = join(repoRoot, "dist", "plugin-server.js");
const releaseAssetsRoot = join(repoRoot, "dist", "release", "assets");
const mcpbManifestPath = join(repoRoot, "plugin", "mcpb", "manifest.json");
const marketplaceManifestPath = join(repoRoot, ".claude-plugin", "marketplace.json");

main();

function main() {
  assertVersion(version);
  assertSourceVersions(version);
  if (publish && distributionGitBranch !== "main" && !skipReleaseAssets) {
    throw new Error("Publishing GitHub Release assets from a non-main distribution branch is forbidden; pass --skip-release-assets for staging");
  }
  if (publish && distributionGitBranch === "main" && skipReleaseAssets) {
    throw new Error("Skipping GitHub Release assets on the main distribution branch is forbidden");
  }
  if (publish && skipReleaseAssets && !skipRemoteVerify) {
    throw new Error("--skip-release-assets requires --skip-remote-verify for staging");
  }
  const target = resolveDistributionTarget();
  try {
    if (target.recreate) {
      rmSync(target.path, { recursive: true, force: true });
      mkdirSync(target.path, { recursive: true });
    } else if (!existsSync(target.path)) {
      throw new Error(`Distribution repository not found: ${target.path}`);
    }

    if (publish && !isGitRepo(target.path)) {
      throw new Error(`Cannot publish because distribution repository is not a git repo: ${target.path}`);
    }
    if (isGitRepo(target.path)) {
      assertCleanGit(target.path);
      if (publish) {
        assertDistributionBranch(target.path);
      }
    }

    if (!skipCheck) {
      run("npm", ["run", "check"], { cwd: repoRoot });
      run("npm", ["run", "pack:claude-delivery"], { cwd: repoRoot });
    } else {
      assertRequiredBuildOutputs();
    }

    assertStandaloneBuildOutputs();
    const releaseAssets = buildReleaseAssets(version);
    assertExistingVersionCompatible(target.path, version);
    syncDistributionRepo(target.path, version);
    assertArchiveFreeDistribution(target.path);

    if (publish) {
      commitAndPush(target.path, version);
      if (!skipReleaseAssets) {
        publishGitHubReleaseAssets(releaseAssets, version);
      }
      if (!skipRemoteVerify) {
        verifyRemoteMcpb(`${releaseDownloadBase}/pipedrive-mcp-${version}.mcpb`, version);
        verifyRemoteMcpb(`${latestReleaseDownloadBase}/pipedrive-mcp-latest.mcpb`, version);
        verifyRemoteStandaloneSkills(releaseDownloadBase);
      }
    }

    console.log(`Archive-free Claude marketplace ready: ${target.path}`);
    console.log(`Claude release assets ready: ${releaseAssetsRoot}`);
  } finally {
    target.cleanup();
  }
}

function resolveDistributionTarget() {
  if (requestedDistributionRepo) {
    return {
      path: resolve(requestedDistributionRepo),
      recreate: false,
      cleanup: () => undefined,
    };
  }

  if (!publish) {
    return {
      path: join(repoRoot, "dist", "release", "pipedrive-mcp-claude-plugin"),
      recreate: true,
      cleanup: () => undefined,
    };
  }

  const cloneRoot = mkdtempSync(join(tmpdir(), "pipedrive-mcp-distribution-clone-"));
  const clonePath = join(cloneRoot, "repository");
  try {
    run("git", ["clone", "--branch", distributionGitBranch, "--single-branch", distributionGitUrl, clonePath], {
      cwd: repoRoot,
    });
  } catch (error) {
    rmSync(cloneRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    path: clonePath,
    recreate: false,
    cleanup: () => rmSync(cloneRoot, { recursive: true, force: true }),
  };
}

function assertVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`Expected semver version like 0.1.6, got: ${value}`);
  }
}

function assertSourceVersions(expectedVersion) {
  assertJsonVersion(join(repoRoot, "package.json"), expectedVersion);
  assertMarketplaceVersion(marketplaceManifestPath, expectedVersion);
  assertJsonVersion(join(repoRoot, "plugin", "claude", ".claude-plugin", "plugin.json"), expectedVersion);
  assertJsonVersion(mcpbManifestPath, expectedVersion);
  const toolsSource = readFileSync(join(repoRoot, "src", "tools.ts"), "utf8");
  const serverVersion = toolsSource.match(/new McpServer\([\s\S]*?version:\s*"(\d+\.\d+\.\d+)"/)?.[1];
  if (serverVersion !== expectedVersion) {
    throw new Error(`src/tools.ts has MCP server version ${serverVersion ?? "<missing>"}; expected ${expectedVersion}`);
  }
}

function assertMarketplaceVersion(path, expectedVersion) {
  const marketplace = readJson(path);
  const plugin = marketplace.plugins?.find((candidate) => candidate?.name === "pipedrive-mcp");
  if (plugin?.version !== expectedVersion) {
    throw new Error(`${path} has Pipedrive plugin version ${plugin?.version}; expected ${expectedVersion}`);
  }
}

function assertJsonVersion(path, expectedVersion) {
  const value = readJson(path).version;
  if (value !== expectedVersion) {
    throw new Error(`${path} has version ${value}; expected ${expectedVersion}`);
  }
}

function assertRequiredBuildOutputs() {
  for (const path of [pluginArtifactRoot, standaloneSkillsRoot, pluginServerPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing build output with --skip-check: ${path}`);
    }
  }
}

function assertStandaloneBuildOutputs() {
  const manifest = readJson(join(standaloneSkillsRoot, "manifest.json"));
  if (manifest.version !== version) {
    throw new Error(`Standalone skills manifest version ${manifest.version}; expected ${version}`);
  }
  for (const skill of manifest.skills ?? []) {
    const versioned = join(standaloneSkillsRoot, skill.versioned);
    const latest = join(standaloneSkillsRoot, skill.latest);
    if (!existsSync(versioned) || !existsSync(latest)) {
      throw new Error(`Missing standalone skill artifacts for ${skill.name}`);
    }
    if (normalizedZipDigest(versioned) !== skill.content_sha256) {
      throw new Error(`${skill.versioned} differs from standalone-skills manifest content_sha256`);
    }
    if (normalizedZipDigest(latest) !== skill.content_sha256) {
      throw new Error(`${skill.latest} differs from ${skill.versioned}`);
    }
  }
}

function buildReleaseAssets(releaseVersion) {
  rmSync(releaseAssetsRoot, { recursive: true, force: true });
  mkdirSync(releaseAssetsRoot, { recursive: true });
  const mcpbSourceRoot = join(releaseAssetsRoot, "mcpb-source");
  const mcpbServerDir = join(mcpbSourceRoot, "server");
  mkdirSync(mcpbServerDir, { recursive: true });
  const manifest = readJson(mcpbManifestPath);
  manifest.version = releaseVersion;
  writeJson(join(mcpbSourceRoot, "manifest.json"), manifest);
  copyFile(pluginServerPath, join(mcpbServerDir, "plugin-server.js"));

  const versionedMcpb = join(releaseAssetsRoot, `pipedrive-mcp-${releaseVersion}.mcpb`);
  const latestMcpb = join(releaseAssetsRoot, "pipedrive-mcp-latest.mcpb");
  buildVersionedMcpb(mcpbSourceRoot, versionedMcpb, releaseVersion);
  copyFile(versionedMcpb, latestMcpb);
  validateMcpb(versionedMcpb, releaseVersion);
  validateMcpb(latestMcpb, releaseVersion);
  rmSync(mcpbSourceRoot, { recursive: true, force: true });

  const standaloneManifest = readJson(join(standaloneSkillsRoot, "manifest.json"));
  const assetPaths = [versionedMcpb, latestMcpb];
  for (const skill of standaloneManifest.skills ?? []) {
    for (const filename of [skill.versioned, skill.latest]) {
      const target = join(releaseAssetsRoot, filename);
      copyFile(join(standaloneSkillsRoot, filename), target);
      assetPaths.push(target);
    }
  }
  const releaseManifest = decorateStandaloneManifest(standaloneManifest);
  const releaseManifestPath = join(releaseAssetsRoot, "standalone-skills-manifest.json");
  writeJson(releaseManifestPath, releaseManifest);
  assetPaths.push(releaseManifestPath);
  return assetPaths;
}

function syncDistributionRepo(targetRepo, releaseVersion) {
  const distributionPluginRoot = join(targetRepo, "plugin");

  copyDirectoryExact(pluginArtifactRoot, distributionPluginRoot);
  assertInstallablePluginTree(distributionPluginRoot);
  copyDirectoryExact(join(pluginArtifactRoot, "docs"), join(targetRepo, "docs"));
  syncStandaloneMetadata(join(targetRepo, "standalone-skills"));
  copyFile(join(pluginArtifactRoot, "README.md"), join(targetRepo, "README.md"));
  copyFile(join(pluginArtifactRoot, "INSTALL.md"), join(targetRepo, "INSTALL.md"));
  copyFile(join(pluginArtifactRoot, "INSTALL.fr.md"), join(targetRepo, "INSTALL.fr.md"));
  copyFile(join(pluginArtifactRoot, "LICENSE"), join(targetRepo, "LICENSE"));

  // Migrate releases that previously exposed the whole repository as the
  // plugin. These paths made standalone ZIPs and MCPBs nested plugin archives.
  rmSync(join(targetRepo, "skills"), { recursive: true, force: true });
  rmSync(join(targetRepo, ".mcp.json"), { force: true });
  rmSync(join(targetRepo, ".claude-plugin", "plugin.json"), { force: true });
  rmSync(join(targetRepo, "mcpb"), { recursive: true, force: true });

  writeDistributionMarketplace(join(targetRepo, ".claude-plugin", "marketplace.json"), releaseVersion);
  removeArchivePayloads(targetRepo);
}

function assertExistingVersionCompatible(targetRepo, releaseVersion) {
  const marketplacePath = join(targetRepo, ".claude-plugin", "marketplace.json");
  if (!existsSync(marketplacePath)) {
    return;
  }
  const marketplace = readJson(marketplacePath);
  const currentPlugin = marketplace.plugins?.find((plugin) => plugin?.name === "pipedrive-mcp");
  const currentVersion = currentPlugin?.version;
  if (currentVersion !== releaseVersion) {
    return;
  }
  if (currentPlugin.source !== "./plugin") {
    throw new Error(`Marketplace source ${currentPlugin.source}; expected ./plugin for release ${releaseVersion}`);
  }

  for (const source of walk(pluginArtifactRoot)) {
    const relativePath = relative(pluginArtifactRoot, source);
    const target = join(targetRepo, "plugin", relativePath);
    if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) {
      throw new Error(`${relativePath} already exists with different content; bump the release version instead of overwriting it`);
    }
  }

  const targetManifest = join(targetRepo, "standalone-skills", "manifest.json");
  const expectedManifest = `${JSON.stringify(decorateStandaloneManifest(readJson(join(standaloneSkillsRoot, "manifest.json"))), null, 2)}\n`;
  if (!existsSync(targetManifest) || readFileSync(targetManifest, "utf8") !== expectedManifest) {
    throw new Error("standalone-skills/manifest.json already exists with different content; bump the release version instead of overwriting it");
  }
}

function writeDistributionMarketplace(path, releaseVersion) {
  const marketplace = readJson(marketplaceManifestPath);
  const matches = marketplace.plugins?.filter((plugin) => plugin?.name === "pipedrive-mcp") ?? [];
  if (matches.length !== 1) {
    throw new Error(`${marketplaceManifestPath} must contain exactly one pipedrive-mcp plugin`);
  }
  // The hosted installer scans the repository snapshot before applying source.
  // Keep the plugin isolated and the whole branch archive-free.
  matches[0].source = "./plugin";
  matches[0].version = releaseVersion;
  writeJson(path, marketplace);
}

function syncStandaloneMetadata(targetRoot) {
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  const manifest = decorateStandaloneManifest(readJson(join(standaloneSkillsRoot, "manifest.json")));
  writeJson(join(targetRoot, "manifest.json"), manifest);
  writeFileSync(
    join(targetRoot, "README.md"),
    [
      "# Standalone Claude skills",
      "",
      "Download the individual ZIP files from the GitHub Release linked in `manifest.json`.",
      "Archives are intentionally not committed to this marketplace branch because Claude rejects nested ZIP payloads.",
      "",
    ].join("\n"),
    "utf8",
  );
}

function decorateStandaloneManifest(manifest) {
  return {
    ...manifest,
    release_tag: releaseTag,
    release_url: `https://github.com/${releaseRepo}/releases/tag/${releaseTag}`,
    skills: (manifest.skills ?? []).map((skill) => ({
      ...skill,
      download_url: `${releaseDownloadBase}/${skill.versioned}`,
      latest_download_url: `${latestReleaseDownloadBase}/${skill.latest}`,
    })),
  };
}

function assertInstallablePluginTree(root) {
  for (const file of walk(root)) {
    const relativePath = relative(root, file);
    if (hasForbiddenArchiveExtension(relativePath)) {
      throw new Error(`Nested archive is forbidden in installable plugin: ${relativePath}`);
    }
    if (hasZipSignature(file)) {
      throw new Error(`ZIP payload is forbidden in installable plugin: ${relativePath}`);
    }
  }
}

function removeArchivePayloads(root) {
  for (const file of walk(root)) {
    const relativePath = relative(root, file);
    if (relativePath === ".git" || relativePath.startsWith(`.git/`)) {
      continue;
    }
    if (hasForbiddenArchiveExtension(relativePath) || hasZipSignature(file)) {
      rmSync(file, { force: true });
    }
  }
}

function assertArchiveFreeDistribution(root) {
  for (const file of walk(root)) {
    const relativePath = relative(root, file);
    if (relativePath === ".git" || relativePath.startsWith(`.git/`)) {
      continue;
    }
    if (hasForbiddenArchiveExtension(relativePath)) {
      throw new Error(`Archive is forbidden in marketplace repository: ${relativePath}`);
    }
    if (hasZipSignature(file)) {
      throw new Error(`ZIP payload is forbidden in marketplace repository: ${relativePath}`);
    }
  }
}

function hasForbiddenArchiveExtension(path) {
  return /\.(?:zip|mcpb|tgz|tar|gz)$/i.test(path);
}

function hasZipSignature(path) {
  const descriptor = openSync(path, "r");
  const header = Buffer.alloc(4);
  try {
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) {
      return false;
    }
  } finally {
    closeSync(descriptor);
  }
  return ["504b0304", "504b0506", "504b0708"].includes(header.toString("hex"));
}

function buildVersionedMcpb(sourceRoot, outputPath, expectedVersion) {
  const candidatePath = `${outputPath}.candidate-${process.pid}`;
  try {
    buildMcpb(sourceRoot, candidatePath);
    validateMcpb(candidatePath, expectedVersion);
    if (existsSync(outputPath)) {
      if (!mcpbPayloadEquals(outputPath, candidatePath)) {
        throw new Error(
          `${basename(outputPath)} already exists with different content; bump the release version instead of overwriting it`,
        );
      }
      return;
    }
    renameSync(candidatePath, outputPath);
  } finally {
    rmSync(candidatePath, { force: true });
  }
}

function mcpbPayloadEquals(left, right) {
  return ["manifest.json", "server/plugin-server.js"].every((member) =>
    readMcpbMember(left, member).equals(readMcpbMember(right, member)),
  );
}

function normalizedZipDigest(path) {
  const digest = createHash("sha256");
  const members = run("unzip", ["-Z1", path], { cwd: repoRoot })
    .split("\n")
    .map((name) => name.trim())
    .filter((name) => name && !name.endsWith("/"))
    .sort();
  for (const member of members) {
    digest.update(member);
    digest.update("\0");
    digest.update(createHash("sha256").update(readMcpbMember(path, member)).digest("hex"));
    digest.update("\n");
  }
  return digest.digest("hex");
}

function readMcpbMember(path, member) {
  return execFileSync("unzip", ["-p", path, member], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function buildMcpb(sourceRoot, outputPath) {
  rmSync(outputPath, { force: true });
  run("zip", ["-qr", outputPath, "manifest.json", "server/plugin-server.js"], { cwd: sourceRoot });
}

function validateMcpb(path, expectedVersion) {
  if (!existsSync(path)) {
    throw new Error(`Missing MCPB artifact: ${path}`);
  }
  const listing = run("unzip", ["-l", path], { cwd: repoRoot });
  for (const required of ["manifest.json", "server/plugin-server.js"]) {
    if (!listing.includes(required)) {
      throw new Error(`${basename(path)} is missing ${required}`);
    }
  }
  const manifest = JSON.parse(run("unzip", ["-p", path, "manifest.json"], { cwd: repoRoot }));
  if (manifest.version !== expectedVersion) {
    throw new Error(`${basename(path)} manifest version ${manifest.version}; expected ${expectedVersion}`);
  }
}

function publishGitHubReleaseAssets(assetPaths, releaseVersion) {
  let release;
  try {
    release = JSON.parse(
      run("gh", ["release", "view", releaseTag, "--repo", releaseRepo, "--json", "assets,tagName"], { cwd: repoRoot }),
    );
  } catch (error) {
    const details = `${error?.stderr ?? ""}\n${error?.message ?? ""}`;
    if (!/release not found|not found.*release/i.test(details)) {
      throw error;
    }
    run(
      "gh",
      [
        "release",
        "create",
        releaseTag,
        "--repo",
        releaseRepo,
        "--target",
        distributionGitBranch,
        "--title",
        `Pipedrive MCP ${releaseVersion}`,
        "--notes",
        "Claude plugin fallback and standalone skill downloads. The marketplace branch itself intentionally contains no archives.",
      ],
      { cwd: repoRoot },
    );
    release = { assets: [], tagName: releaseTag };
  }

  const existingNames = new Set((release.assets ?? []).map((asset) => asset.name));
  const verificationDir = mkdtempSync(join(tmpdir(), "pipedrive-mcp-existing-release-"));
  try {
    for (const assetPath of assetPaths) {
      const name = basename(assetPath);
      if (existingNames.has(name)) {
        run(
          "gh",
          ["release", "download", releaseTag, "--repo", releaseRepo, "--pattern", name, "--dir", verificationDir],
          { cwd: repoRoot },
        );
        const publishedPath = join(verificationDir, name);
        if (!releaseAssetEquals(assetPath, publishedPath)) {
          throw new Error(`${name} already exists with different content; bump the release version instead of overwriting it`);
        }
        continue;
      }
      run("gh", ["release", "upload", releaseTag, assetPath, "--repo", releaseRepo], { cwd: repoRoot });
    }
  } finally {
    rmSync(verificationDir, { recursive: true, force: true });
  }
}

function releaseAssetEquals(localPath, publishedPath) {
  if (localPath.endsWith(".mcpb")) {
    return mcpbPayloadEquals(localPath, publishedPath);
  }
  if (localPath.endsWith(".zip")) {
    return normalizedZipDigest(localPath) === normalizedZipDigest(publishedPath);
  }
  return readFileSync(localPath).equals(readFileSync(publishedPath));
}

function verifyRemoteMcpb(url, expectedVersion) {
  const tempDir = mkdtempSync(join(tmpdir(), "pipedrive-mcp-release-"));
  const target = join(tempDir, basename(url));
  try {
    run("curl", ["-fsSL", url, "-o", target], { cwd: repoRoot });
    validateMcpb(target, expectedVersion);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyRemoteStandaloneSkills(urlBase) {
  const manifest = readJson(join(standaloneSkillsRoot, "manifest.json"));
  const tempDir = mkdtempSync(join(tmpdir(), "pipedrive-mcp-skills-release-"));
  try {
    for (const skill of manifest.skills ?? []) {
      const target = join(tempDir, skill.versioned);
      run("curl", ["-fsSL", `${urlBase}/${skill.versioned}`, "-o", target], { cwd: repoRoot });
      if (normalizedZipDigest(target) !== skill.content_sha256) {
        throw new Error(`Published standalone skill differs from its manifest: ${skill.versioned}`);
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function commitAndPush(targetRepo, releaseVersion) {
  if (!isGitRepo(targetRepo)) {
    throw new Error(`Cannot publish because distribution repository is not a git repo: ${targetRepo}`);
  }
  run("git", ["add", "."], { cwd: targetRepo });
  const status = run("git", ["status", "--porcelain"], { cwd: targetRepo }).trim();
  if (!status) {
    console.log("Distribution repository already up to date.");
  } else {
    run(
      "git",
      [
        "commit",
        "-m",
        `release ${releaseVersion} Pipedrive MCP delivery`,
        "-m",
        [
          "# Why",
          "# - Publish an archive-free marketplace snapshot accepted by Claude's hosted installer.",
          "# - Keep standalone ZIPs and the Desktop fallback outside the repository tree.",
          "# What",
          "# - Sync the isolated remote plugin, docs, and standalone download metadata.",
          "# - Remove historical ZIP, MCPB, and disguised ZIP payloads from the branch snapshot.",
          "# Tests",
          "# - whole-repository archive scan",
          "# - GitHub Release asset validation after push",
        ].join("\n"),
      ],
      { cwd: targetRepo },
    );
  }
  run("git", ["push", "origin", distributionGitBranch], { cwd: targetRepo });
}

function assertCleanGit(path) {
  const status = run("git", ["status", "--porcelain"], { cwd: path }).trim();
  if (status) {
    throw new Error(`Distribution repository has uncommitted changes:\n${status}`);
  }
}

function assertDistributionBranch(path) {
  const currentBranch = run("git", ["branch", "--show-current"], { cwd: path }).trim();
  if (currentBranch !== distributionGitBranch) {
    throw new Error(`Distribution repository is on branch ${currentBranch || "<detached>"}; expected ${distributionGitBranch}`);
  }
}

function isGitRepo(path) {
  try {
    const topLevel = run("git", ["rev-parse", "--show-toplevel"], { cwd: path }).trim();
    return realpathSync(topLevel) === realpathSync(path);
  } catch {
    return false;
  }
}

function copyDirectoryExact(source, target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: false });
}

function copyFile(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { dereference: false });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(command, commandArgs, options) {
  return execFileSync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseArgs(rawArgs) {
  const booleanArgs = new Set(["publish", "skip-check", "skip-remote-verify", "skip-release-assets"]);
  const valueArgs = new Set([
    "version",
    "distribution-repo",
    "distribution-git-url",
    "distribution-git-branch",
    "release-repo",
    "release-tag",
    "release-download-base",
    "latest-release-download-base",
  ]);
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const raw = rawArgs[index];
    if (!raw.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${raw}`);
    }
    const key = raw.slice(2);
    if (!booleanArgs.has(key) && !valueArgs.has(key)) {
      throw new Error(`Unknown option: --${key}`);
    }
    const next = rawArgs[index + 1];
    if (booleanArgs.has(key)) {
      if (next && !next.startsWith("--")) {
        throw new Error(`--${key} does not accept a value`);
      }
      parsed[key] = true;
      continue;
    }
    if (!next || next.startsWith("--")) {
      throw new Error(`--${key} requires a value`);
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}
