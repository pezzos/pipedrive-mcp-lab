import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const repoRoot = process.cwd();
const packageJson = readJson(join(repoRoot, "package.json"));
const args = parseArgs(process.argv.slice(2));
const version = args.version ?? packageJson.version;
const publish = Boolean(args.publish);
const skipCheck = Boolean(args["skip-check"]);
const distributionRepo = resolve(
  args["distribution-repo"] ??
    process.env.PIPEDRIVE_MCP_PLUGIN_REPO ??
    join(repoRoot, "..", "pipedrive-mcp-claude-plugin"),
);
const remoteUrlBase =
  args["remote-url-base"] ?? "https://github.com/pezzos/pipedrive-mcp-claude-plugin/raw/main";

const pluginArtifactRoot = join(repoRoot, "dist", "claude-plugin", "pipedrive-mcp");
const pluginServerPath = join(repoRoot, "dist", "plugin-server.js");
const mcpbManifestPath = join(repoRoot, "plugin", "mcpb", "manifest.json");

main();

function main() {
  assertVersion(version);
  assertSourceVersions(version);

  if (!existsSync(distributionRepo)) {
    throw new Error(
      `Distribution repository not found: ${distributionRepo}. Set PIPEDRIVE_MCP_PLUGIN_REPO or pass --distribution-repo.`,
    );
  }

  if (isGitRepo(distributionRepo)) {
    assertCleanGit(distributionRepo);
  }

  if (!skipCheck) {
    run("npm", ["run", "check"], { cwd: repoRoot });
  } else {
    assertRequiredBuildOutputs();
  }

  syncDistributionRepo(distributionRepo, version);

  const versionedMcpb = join(distributionRepo, `pipedrive-mcp-${version}.mcpb`);
  const latestMcpb = join(distributionRepo, "pipedrive-mcp-latest.mcpb");
  validateMcpb(versionedMcpb, version);
  validateMcpb(latestMcpb, version);

  if (publish) {
    commitAndPush(distributionRepo, version);
    verifyRemoteMcpb(`${remoteUrlBase}/pipedrive-mcp-${version}.mcpb`, version);
    verifyRemoteMcpb(`${remoteUrlBase}/pipedrive-mcp-latest.mcpb`, version);
  }

  console.log(`Claude plugin release artifact ready: ${versionedMcpb}`);
  console.log(`Claude plugin latest alias ready: ${latestMcpb}`);
}

function assertVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`Expected semver version like 0.1.6, got: ${value}`);
  }
}

function assertSourceVersions(expectedVersion) {
  assertJsonVersion(join(repoRoot, "package.json"), expectedVersion);
  assertJsonVersion(join(repoRoot, "plugin", "claude", ".claude-plugin", "plugin.json"), expectedVersion);
  assertJsonVersion(mcpbManifestPath, expectedVersion);
}

function assertJsonVersion(path, expectedVersion) {
  const value = readJson(path).version;
  if (value !== expectedVersion) {
    throw new Error(`${path} has version ${value}; expected ${expectedVersion}`);
  }
}

function assertRequiredBuildOutputs() {
  for (const path of [pluginArtifactRoot, pluginServerPath]) {
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
  copyFile(join(pluginArtifactRoot, ".claude-plugin", "plugin.json"), join(targetRepo, ".claude-plugin", "plugin.json"));
  copyFile(join(pluginArtifactRoot, "README.md"), join(targetRepo, "README.md"));
  copyFile(join(pluginArtifactRoot, "INSTALL.md"), join(targetRepo, "INSTALL.md"));
  copyFile(join(pluginArtifactRoot, "INSTALL.fr.md"), join(targetRepo, "INSTALL.fr.md"));
  copyFile(join(pluginArtifactRoot, "LICENSE"), join(targetRepo, "LICENSE"));

  updateMarketplace(join(targetRepo, ".claude-plugin", "marketplace.json"), releaseVersion);

  mkdirSync(mcpbServerDir, { recursive: true });
  const manifest = readJson(mcpbManifestPath);
  manifest.version = releaseVersion;
  writeJson(join(mcpbSourceRoot, "manifest.json"), manifest);
  copyFile(pluginServerPath, join(mcpbServerDir, "plugin-server.js"));

  buildMcpb(mcpbSourceRoot, versionedMcpb);
  copyFile(versionedMcpb, latestMcpb);
}

function updateMarketplace(path, releaseVersion) {
  if (!existsSync(path)) {
    return;
  }
  const marketplace = readJson(path);
  if (Array.isArray(marketplace.plugins)) {
    for (const plugin of marketplace.plugins) {
      if (plugin?.name === "pipedrive-mcp") {
        plugin.version = releaseVersion;
      }
    }
  }
  writeJson(path, marketplace);
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
        `release ${releaseVersion} desktop extension`,
        "-m",
        [
          "# Why",
          "# - Publish the Claude Desktop Extension binary referenced by client install docs.",
          "# - Keep the versioned artifact and latest alias in sync.",
          "# What",
          `# - Generate pipedrive-mcp-${releaseVersion}.mcpb and pipedrive-mcp-latest.mcpb.`,
          "# - Sync the Claude plugin skills, docs, and MCPB manifest from the source repo.",
          "# Tests",
          "# - local MCPB manifest validation",
          "# - remote MCPB download validation after push",
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
  return existsSync(join(path, ".git"));
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
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const raw = rawArgs[index];
    if (!raw.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${raw}`);
    }
    const key = raw.slice(2);
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
