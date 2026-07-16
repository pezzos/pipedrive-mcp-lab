import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
const requestedDistributionRepo = args["distribution-repo"] ?? process.env.PIPEDRIVE_MCP_PLUGIN_REPO;
const distributionGitUrl =
  args["distribution-git-url"] ??
  process.env.PIPEDRIVE_MCP_PLUGIN_GIT_URL ??
  "https://github.com/pezzos/pipedrive-mcp-claude-plugin.git";
const remoteUrlBase =
  args["remote-url-base"] ?? "https://github.com/pezzos/pipedrive-mcp-claude-plugin/raw/main";

const pluginArtifactRoot = join(repoRoot, "dist", "claude-plugin", "pipedrive-mcp");
const standaloneSkillsRoot = join(repoRoot, "dist", "claude-skills");
const pluginServerPath = join(repoRoot, "dist", "plugin-server.js");
const mcpbManifestPath = join(repoRoot, "plugin", "mcpb", "manifest.json");
const marketplaceManifestPath = join(repoRoot, ".claude-plugin", "marketplace.json");

main();

function main() {
  assertVersion(version);
  assertSourceVersions(version);
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
    }

    if (!skipCheck) {
      run("npm", ["run", "check"], { cwd: repoRoot });
      run("npm", ["run", "pack:claude-delivery"], { cwd: repoRoot });
    } else {
      assertRequiredBuildOutputs();
    }

    assertExistingVersionCompatible(target.path, version);
    syncDistributionRepo(target.path, version);

    const versionedMcpb = join(target.path, `pipedrive-mcp-${version}.mcpb`);
    const latestMcpb = join(target.path, "pipedrive-mcp-latest.mcpb");
    validateMcpb(versionedMcpb, version);
    validateMcpb(latestMcpb, version);

    if (publish) {
      commitAndPush(target.path, version);
      if (!skipRemoteVerify) {
        verifyRemoteMcpb(`${remoteUrlBase}/pipedrive-mcp-${version}.mcpb`, version);
        verifyRemoteMcpb(`${remoteUrlBase}/pipedrive-mcp-latest.mcpb`, version);
        verifyRemoteStandaloneSkills(remoteUrlBase);
      }
    }

    console.log(`Claude plugin release artifact ready: ${versionedMcpb}`);
    console.log(`Claude plugin latest alias ready: ${latestMcpb}`);
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
    run("git", ["clone", "--branch", "main", "--single-branch", distributionGitUrl, clonePath], {
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

function syncDistributionRepo(targetRepo, releaseVersion) {
  const mcpbSourceRoot = join(targetRepo, "mcpb", "pipedrive-mcp");
  const mcpbServerDir = join(mcpbSourceRoot, "server");
  const versionedMcpb = join(targetRepo, `pipedrive-mcp-${releaseVersion}.mcpb`);
  const latestMcpb = join(targetRepo, "pipedrive-mcp-latest.mcpb");

  copyDirectoryExact(join(pluginArtifactRoot, "skills"), join(targetRepo, "skills"));
  copyDirectoryExact(join(pluginArtifactRoot, "docs"), join(targetRepo, "docs"));
  copyDirectoryExact(standaloneSkillsRoot, join(targetRepo, "standalone-skills"));
  copyFile(join(pluginArtifactRoot, ".claude-plugin", "plugin.json"), join(targetRepo, ".claude-plugin", "plugin.json"));
  copyFile(join(pluginArtifactRoot, ".mcp.json"), join(targetRepo, ".mcp.json"));
  copyFile(join(pluginArtifactRoot, "README.md"), join(targetRepo, "README.md"));
  copyFile(join(pluginArtifactRoot, "INSTALL.md"), join(targetRepo, "INSTALL.md"));
  copyFile(join(pluginArtifactRoot, "INSTALL.fr.md"), join(targetRepo, "INSTALL.fr.md"));
  copyFile(join(pluginArtifactRoot, "LICENSE"), join(targetRepo, "LICENSE"));

  writeDistributionMarketplace(join(targetRepo, ".claude-plugin", "marketplace.json"), releaseVersion);

  mkdirSync(mcpbServerDir, { recursive: true });
  const manifest = readJson(mcpbManifestPath);
  manifest.version = releaseVersion;
  writeJson(join(mcpbSourceRoot, "manifest.json"), manifest);
  copyFile(pluginServerPath, join(mcpbServerDir, "plugin-server.js"));

  buildVersionedMcpb(mcpbSourceRoot, versionedMcpb, releaseVersion);
  copyFile(versionedMcpb, latestMcpb);
}

function assertExistingVersionCompatible(targetRepo, releaseVersion) {
  const marketplacePath = join(targetRepo, ".claude-plugin", "marketplace.json");
  if (!existsSync(marketplacePath)) {
    return;
  }
  const marketplace = readJson(marketplacePath);
  const currentVersion = marketplace.plugins?.find((plugin) => plugin?.name === "pipedrive-mcp")?.version;
  if (currentVersion !== releaseVersion) {
    return;
  }

  for (const source of walk(pluginArtifactRoot)) {
    const relativePath = relative(pluginArtifactRoot, source);
    const target = join(targetRepo, relativePath);
    if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) {
      throw new Error(`${relativePath} already exists with different content; bump the release version instead of overwriting it`);
    }
  }

  const manifest = readJson(join(standaloneSkillsRoot, "manifest.json"));
  const targetManifest = join(targetRepo, "standalone-skills", "manifest.json");
  if (!existsSync(targetManifest) || !readFileSync(join(standaloneSkillsRoot, "manifest.json")).equals(readFileSync(targetManifest))) {
    throw new Error("standalone-skills/manifest.json already exists with different content; bump the release version instead of overwriting it");
  }
  for (const skill of manifest.skills ?? []) {
    const source = join(standaloneSkillsRoot, skill.versioned);
    const target = join(targetRepo, "standalone-skills", skill.versioned);
    if (!existsSync(target) || normalizedZipDigest(source) !== normalizedZipDigest(target)) {
      throw new Error(`${skill.versioned} already exists with different content; bump the release version instead of overwriting it`);
    }
  }
}

function writeDistributionMarketplace(path, releaseVersion) {
  const marketplace = readJson(marketplaceManifestPath);
  const matches = marketplace.plugins?.filter((plugin) => plugin?.name === "pipedrive-mcp") ?? [];
  if (matches.length !== 1) {
    throw new Error(`${marketplaceManifestPath} must contain exactly one pipedrive-mcp plugin`);
  }
  // Claude's remote marketplace backend only recognizes repository-local
  // plugin paths when they are explicitly relative ("./"). A bare "." is
  // accepted by the local CLI validator but rejected during Desktop sync.
  matches[0].source = "./";
  matches[0].version = releaseVersion;
  writeJson(path, marketplace);
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
      run("curl", ["-fsSL", `${urlBase}/standalone-skills/${skill.versioned}`, "-o", target], { cwd: repoRoot });
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
          "# - Publish the paid cross-surface plugin, standalone skills, and Desktop fallback.",
          "# - Keep versioned artifacts and latest aliases in sync.",
          "# What",
          `# - Generate pipedrive-mcp-${releaseVersion}.mcpb and pipedrive-mcp-latest.mcpb.`,
          "# - Sync the remote plugin, standalone skill ZIPs, docs, and MCPB manifest from the source repo.",
          "# Tests",
          "# - local MCPB manifest validation",
          "# - remote MCPB and standalone skill download validation after push",
        ].join("\n"),
      ],
      { cwd: targetRepo },
    );
  }
  run("git", ["push", "origin", "main"], { cwd: targetRepo });
}

function assertCleanGit(path) {
  const status = run("git", ["status", "--porcelain"], { cwd: path }).trim();
  if (status) {
    throw new Error(`Distribution repository has uncommitted changes:\n${status}`);
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
  const booleanArgs = new Set(["publish", "skip-check", "skip-remote-verify"]);
  const valueArgs = new Set(["version", "distribution-repo", "distribution-git-url", "remote-url-base"]);
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
