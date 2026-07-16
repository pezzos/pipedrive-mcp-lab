import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { assertSafeTextTree, walk } from "../scripts/lib/artifact-safety.mjs";

const readOnlyToolCount = 46;
const artifactRoot = join(process.cwd(), "dist", "claude-plugin", "pipedrive-mcp");
const standaloneSkillsRoot = join(process.cwd(), "dist", "claude-skills");
const releaseAssetsRoot = join(process.cwd(), "dist", "release", "assets");
const packageVersion = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
const expectedSkillNames = [
  "pipedrive-add-activity",
  "pipedrive-add-note",
  "pipedrive-complete-activity",
  "pipedrive-dictation-aliases",
  "pipedrive-email-activity",
  "pipedrive-next-action",
  "pipedrive-update-record",
];

test("standalone MCP server bundle exposes the read-only profile directly", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const tools = await listTools(join(process.cwd(), "dist", "plugin-server.js"), process.cwd());
  assertReadOnlyProfile(tools);
});

test("standalone MCP server bundle starts before credentials are configured", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const tools = await listTools(join(process.cwd(), "dist", "plugin-server.js"), process.cwd(), {
    PIPEDRIVE_API_TOKEN: undefined,
  });
  assertReadOnlyProfile(tools);
});

test("staged Claude plugin artifact is isolated and read-only by default", { timeout: 180_000 }, async () => {
  execFileSync("npm", ["run", "pack:claude-plugin"], { cwd: process.cwd(), stdio: "pipe" });

  const pluginJsonPath = join(artifactRoot, ".claude-plugin", "plugin.json");
  assert.equal(existsSync(pluginJsonPath), true);
  const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
  assert.equal(pluginJson.version, packageVersion);
  assert.equal(pluginJson.skills, "./skills/");
  assert.equal("mcpServers" in pluginJson, false);
  assert.equal("userConfig" in pluginJson, false);
  assert.equal(existsSync(join(artifactRoot, ".mcp.json")), true);
  assert.deepEqual(JSON.parse(readFileSync(join(artifactRoot, ".mcp.json"), "utf8")), {
    mcpServers: {
      "pipedrive-mcp": {
        type: "http",
        url: "https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp",
      },
    },
  });
  assert.equal(existsSync(join(artifactRoot, "dist", "plugin-server.js")), false);
  assert.equal(existsSync(join(artifactRoot, "INSTALL.md")), true);
  assert.equal(existsSync(join(artifactRoot, "INSTALL.fr.md")), true);
  assert.equal(existsSync(join(artifactRoot, "docs", "CLAUDE_DELIVERY.md")), true);
  assert.equal(existsSync(join(artifactRoot, "docs", "REMOTE_MCP_CLOUDFLARE.md")), true);
  const artifactReadme = readFileSync(join(artifactRoot, "README.md"), "utf8");
  assert.match(artifactReadme, /English installation guide/);
  assert.match(artifactReadme, /pipedrive-mcp-latest\.mcpb/);
  assert.doesNotMatch(artifactReadme, /npm install/);
  const skillNames = readdirSync(join(artifactRoot, "skills")).sort();
  assert.deepEqual(skillNames, expectedSkillNames);
  for (const skillName of expectedSkillNames) {
    assert.equal(existsSync(join(artifactRoot, "skills", skillName, "SKILL.md")), true);
  }

  for (const skillDir of skillNames) {
    const skillPath = join(artifactRoot, "skills", skillDir, "SKILL.md");
    const skillText = readFileSync(skillPath, "utf8");
    assert.match(skillText, /Requires Pipedrive MCP\./);
    assert.match(skillText, /Use only `pipedrive_\*` tools\./);
    assert.match(skillText, /Do not use the official Pipedrive connector\./);
  }

  assert.doesNotThrow(() => assertSafeTextTree(artifactRoot, { allowedMcpConfig: ".mcp.json" }));
});

test("standalone Claude skill archives match the canonical plugin skills", { timeout: 180_000 }, () => {
  execFileSync("npm", ["run", "pack:claude-delivery"], { cwd: process.cwd(), stdio: "pipe" });

  const manifest = JSON.parse(readFileSync(join(standaloneSkillsRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.version, packageVersion);
  assert.deepEqual(manifest.skills.map((skill: { name: string }) => skill.name), expectedSkillNames);

  for (const skill of manifest.skills) {
    const versioned = join(standaloneSkillsRoot, skill.versioned);
    const latest = join(standaloneSkillsRoot, skill.latest);
    assert.equal(skill.versioned, `${skill.name}-${packageVersion}.zip`);
    assert.equal(skill.latest, `${skill.name}-latest.zip`);
    assert.equal(existsSync(versioned), true);
    assert.equal(existsSync(latest), true);
    assert.equal(normalizedZipDigest(versioned), normalizedZipDigest(latest));
    assert.equal(normalizedZipDigest(versioned), skill.content_sha256);
    const members = listZipMembers(versioned);
    assert.equal(members.includes(`${skill.name}/SKILL.md`), true);
    assert.equal(members.some((member) => member.endsWith(".mcp.json")), false);
    assert.equal(members.some((member) => member.includes(".claude-plugin")), false);
    const archivedSkill = execFileSync("unzip", ["-p", versioned, `${skill.name}/SKILL.md`]);
    const pluginSkill = readFileSync(join(artifactRoot, "skills", skill.name, "SKILL.md"));
    assert.equal(archivedSkill.equals(pluginSkill), true, `${skill.name} must match in Free and paid artifacts`);
  }
});

test("artifact safety rejects symbolic links", () => {
  const root = mkdtempSync(join(tmpdir(), "pipedrive-mcp-artifact-safety-"));
  try {
    writeFileSync(join(root, "target.txt"), "safe\n", "utf8");
    symlinkSync("target.txt", join(root, "linked.txt"));
    assert.throws(() => assertSafeTextTree(root), /Symbolic links are forbidden/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all coupled delivery manifests use the package version", () => {
  const packageLock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(process.cwd(), "plugin", "claude", ".claude-plugin", "plugin.json"), "utf8"));
  const marketplace = JSON.parse(readFileSync(join(process.cwd(), ".claude-plugin", "marketplace.json"), "utf8"));
  const mcpb = JSON.parse(readFileSync(join(process.cwd(), "plugin", "mcpb", "manifest.json"), "utf8"));
  assert.equal(packageLock.version, packageVersion);
  assert.equal(packageLock.packages[""].version, packageVersion);
  assert.equal(plugin.version, packageVersion);
  assert.equal(marketplace.plugins[0].version, packageVersion);
  assert.equal(mcpb.version, packageVersion);
  assert.match(readFileSync(join(process.cwd(), "src", "tools.ts"), "utf8"), new RegExp(`version: "${packageVersion.replaceAll(".", "\\.")}"`));
});

test("Claude plugin release script stages versioned and latest MCPB artifacts", { timeout: 180_000 }, () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });
  execFileSync("npm", ["run", "pack:claude-plugin"], { cwd: process.cwd(), stdio: "pipe" });
  execFileSync("npm", ["run", "pack:claude-skills"], { cwd: process.cwd(), stdio: "pipe" });

  const distributionRepo = mkdtempSync(join(tmpdir(), "pipedrive-mcp-distribution-"));
  try {
    execFileSync(
      "node",
      [
        "scripts/release-claude-plugin.mjs",
        "--distribution-repo",
        distributionRepo,
        "--skip-check",
      ],
      { cwd: process.cwd(), stdio: "pipe" },
    );

    const versionedMcpb = join(releaseAssetsRoot, `pipedrive-mcp-${packageVersion}.mcpb`);
    const latestMcpb = join(releaseAssetsRoot, "pipedrive-mcp-latest.mcpb");
    assert.equal(existsSync(versionedMcpb), true);
    assert.equal(existsSync(latestMcpb), true);

    assert.equal(readMcpbManifest(versionedMcpb).version, packageVersion);
    assert.equal(readMcpbManifest(latestMcpb).version, packageVersion);
    assert.notEqual(readMcpbManifest(versionedMcpb).user_config.api_token.required, true);
    assertInstallableDistributionPlugin(distributionRepo);
    assertArchiveFreeDistribution(distributionRepo);
    assert.equal(existsSync(join(distributionRepo, "skills")), false);
    assert.equal(existsSync(join(distributionRepo, ".mcp.json")), false);
    assert.equal(existsSync(join(distributionRepo, ".claude-plugin", "plugin.json")), false);
    assert.equal(existsSync(join(distributionRepo, "standalone-skills", `pipedrive-add-note-${packageVersion}.zip`)), false);
    assert.equal(existsSync(join(distributionRepo, "standalone-skills", "pipedrive-add-note-latest.zip")), false);
    const standaloneManifest = JSON.parse(
      readFileSync(join(distributionRepo, "standalone-skills", "manifest.json"), "utf8"),
    );
    assert.match(standaloneManifest.skills[0].download_url, new RegExp(`/releases/download/v${packageVersion.replaceAll(".", "\\.")}`));
    assert.equal(existsSync(join(releaseAssetsRoot, `pipedrive-add-note-${packageVersion}.zip`)), true);
    const marketplace = JSON.parse(readFileSync(join(distributionRepo, ".claude-plugin", "marketplace.json"), "utf8"));
    assert.equal(marketplace.plugins[0].name, "pipedrive-mcp");
    assert.equal(marketplace.plugins[0].source, "./plugin");
    assert.equal(marketplace.plugins[0].version, packageVersion);

    const readme = readFileSync(join(distributionRepo, "README.md"), "utf8");
    assert.match(readme, /pipedrive-mcp-latest\.mcpb/);
  } finally {
    rmSync(distributionRepo, { recursive: true, force: true });
  }
});

test("Claude plugin release preparation defaults to a generated directory inside dist", { timeout: 180_000 }, () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });
  execFileSync("npm", ["run", "pack:claude-plugin"], { cwd: process.cwd(), stdio: "pipe" });
  execFileSync("npm", ["run", "pack:claude-skills"], { cwd: process.cwd(), stdio: "pipe" });

  const distributionRoot = join(process.cwd(), "dist", "release", "pipedrive-mcp-claude-plugin");
  execFileSync("node", ["scripts/release-claude-plugin.mjs", "--skip-check"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });

  assert.equal(existsSync(join(releaseAssetsRoot, `pipedrive-mcp-${packageVersion}.mcpb`)), true);
  assert.equal(existsSync(join(releaseAssetsRoot, "pipedrive-mcp-latest.mcpb")), true);
  assertInstallableDistributionPlugin(distributionRoot);
  assertArchiveFreeDistribution(distributionRoot);
  assert.equal(existsSync(join(distributionRoot, "skills")), false);
  assert.equal(existsSync(join(distributionRoot, ".mcp.json")), false);
  assert.equal(existsSync(join(distributionRoot, "standalone-skills", `pipedrive-add-note-${packageVersion}.zip`)), false);
  const marketplace = JSON.parse(readFileSync(join(distributionRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  assert.equal(marketplace.plugins[0].source, "./plugin");
  assert.equal(marketplace.plugins[0].version, packageVersion);
});

test("Claude plugin release rejects a renamed ZIP inside the installable plugin", { timeout: 180_000 }, () => {
  execFileSync("npm", ["run", "pack:claude-delivery"], { cwd: process.cwd(), stdio: "pipe" });
  const disguisedArchive = join(artifactRoot, "nested-archive.bin");
  const distributionRepo = mkdtempSync(join(tmpdir(), "pipedrive-mcp-unsafe-distribution-"));
  try {
    writeFileSync(disguisedArchive, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
    assert.throws(
      () =>
        execFileSync(
          "node",
          ["scripts/release-claude-plugin.mjs", "--distribution-repo", distributionRepo, "--skip-check"],
          { cwd: process.cwd(), stdio: "pipe" },
        ),
      /ZIP payload is forbidden in installable plugin/,
    );
  } finally {
    rmSync(disguisedArchive, { force: true });
    rmSync(distributionRepo, { recursive: true, force: true });
  }
});

test("Claude plugin publication can use a disposable clone of the distribution repository", { timeout: 180_000 }, () => {
  execFileSync("npm", ["run", "build:plugin"], { cwd: process.cwd(), stdio: "pipe" });
  execFileSync("npm", ["run", "pack:claude-plugin"], { cwd: process.cwd(), stdio: "pipe" });
  execFileSync("npm", ["run", "pack:claude-skills"], { cwd: process.cwd(), stdio: "pipe" });

  const root = mkdtempSync(join(tmpdir(), "pipedrive-mcp-publish-test-"));
  const remote = join(root, "distribution.git");
  const seed = join(root, "seed");
  const verificationClone = join(root, "verification");
  const gitIdentity = {
    ...process.env,
    GIT_AUTHOR_NAME: "Pipedrive MCP Tests",
    GIT_AUTHOR_EMAIL: "tests@example.invalid",
    GIT_COMMITTER_NAME: "Pipedrive MCP Tests",
    GIT_COMMITTER_EMAIL: "tests@example.invalid",
  };

  try {
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { stdio: "pipe" });
    mkdirSync(seed);
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: seed, stdio: "pipe" });
    mkdirSync(join(seed, ".claude-plugin"));
    writeFileSync(
      join(seed, ".claude-plugin", "marketplace.json"),
      `${JSON.stringify({ name: "pezzoslabs-pipedrive", plugins: [{ name: "pipedrive-mcp", version: "0.0.0" }] }, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(join(seed, ".claude-plugin", "plugin.json"), "{}\n", "utf8");
    writeFileSync(join(seed, ".mcp.json"), "{}\n", "utf8");
    mkdirSync(join(seed, "skills", "legacy"), { recursive: true });
    writeFileSync(join(seed, "skills", "legacy", "SKILL.md"), "legacy\n", "utf8");
    mkdirSync(join(seed, "standalone-skills"), { recursive: true });
    const historicalStandalone = Buffer.from("historical-0.3.1-archive\n");
    writeFileSync(join(seed, "standalone-skills", "pipedrive-add-note-0.3.1.zip"), historicalStandalone);
    writeFileSync(join(seed, "pipedrive-mcp-0.3.1.mcpb"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    writeFileSync(join(seed, "pipedrive-mcp-latest.mcpb"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    execFileSync("git", ["add", "."], { cwd: seed, env: gitIdentity, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "seed distribution"], { cwd: seed, env: gitIdentity, stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed, stdio: "pipe" });
    execFileSync("git", ["push", "-u", "origin", "main:release-test"], { cwd: seed, stdio: "pipe" });

    execFileSync(
      "node",
      [
        "scripts/release-claude-plugin.mjs",
        "--publish",
        "--distribution-git-url",
        remote,
        "--distribution-git-branch",
        "release-test",
        "--skip-release-assets",
        "--skip-check",
        "--skip-remote-verify",
      ],
      { cwd: process.cwd(), env: gitIdentity, stdio: "pipe" },
    );

    execFileSync("git", ["clone", "--branch", "release-test", remote, verificationClone], { stdio: "pipe" });
    assertInstallableDistributionPlugin(verificationClone);
    assertArchiveFreeDistribution(verificationClone);
    assert.equal(existsSync(join(verificationClone, ".claude-plugin", "plugin.json")), false);
    assert.equal(existsSync(join(verificationClone, ".mcp.json")), false);
    assert.equal(existsSync(join(verificationClone, "skills")), false);
    assert.equal(existsSync(join(verificationClone, "standalone-skills", "pipedrive-add-note-0.3.1.zip")), false);
    assert.equal(existsSync(join(verificationClone, "pipedrive-mcp-0.3.1.mcpb")), false);
    assert.equal(existsSync(join(verificationClone, "pipedrive-mcp-latest.mcpb")), false);
    const marketplace = JSON.parse(readFileSync(join(verificationClone, ".claude-plugin", "marketplace.json"), "utf8"));
    assert.equal(marketplace.plugins[0].source, "./plugin");
    assert.equal(marketplace.plugins[0].version, packageVersion);

    const commitCount = gitCommitCount(remote, "release-test");
    execFileSync(
      "node",
      [
        "scripts/release-claude-plugin.mjs",
        "--publish",
        "--distribution-git-url",
        remote,
        "--distribution-git-branch",
        "release-test",
        "--skip-release-assets",
        "--skip-check",
        "--skip-remote-verify",
      ],
      { cwd: process.cwd(), env: gitIdentity, stdio: "pipe" },
    );
    assert.equal(gitCommitCount(remote, "release-test"), commitCount, "an identical release must not create another commit");

    const remoteMcpArtifact = join(artifactRoot, ".mcp.json");
    const originalRemoteMcp = readFileSync(remoteMcpArtifact);
    try {
      writeFileSync(remoteMcpArtifact, '{"mcpServers":{"pipedrive-mcp":{"type":"http","url":"https://changed.invalid/mcp"}}}\n');
      assert.throws(
        () =>
          execFileSync(
            "node",
            [
              "scripts/release-claude-plugin.mjs",
              "--publish",
              "--distribution-git-url",
              remote,
              "--distribution-git-branch",
              "release-test",
              "--skip-release-assets",
              "--skip-check",
              "--skip-remote-verify",
            ],
            { cwd: process.cwd(), env: gitIdentity, stdio: "pipe" },
          ),
        /differs from|different content|bump the release version/,
      );
      assert.equal(gitCommitCount(remote, "release-test"), commitCount);
    } finally {
      writeFileSync(remoteMcpArtifact, originalRemoteMcp);
    }

    const skillArchive = join(standaloneSkillsRoot, `pipedrive-add-note-${packageVersion}.zip`);
    const originalSkillArchive = readFileSync(skillArchive);
    const tamperedFile = join(root, "tampered.txt");
    try {
      writeFileSync(tamperedFile, "tampered\n", "utf8");
      execFileSync("zip", ["-q", skillArchive, basename(tamperedFile)], { cwd: root, stdio: "pipe" });
      assert.throws(
        () =>
          execFileSync(
            "node",
            [
              "scripts/release-claude-plugin.mjs",
              "--publish",
              "--distribution-git-url",
              remote,
              "--distribution-git-branch",
              "release-test",
              "--skip-release-assets",
              "--skip-check",
              "--skip-remote-verify",
            ],
            { cwd: process.cwd(), env: gitIdentity, stdio: "pipe" },
          ),
        /differs from|different content|bump the release version/,
      );
      assert.equal(gitCommitCount(remote, "release-test"), commitCount);
    } finally {
      writeFileSync(skillArchive, originalSkillArchive);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude plugin publication uploads immutable GitHub Release assets", { timeout: 180_000 }, () => {
  execFileSync("npm", ["run", "pack:claude-delivery"], { cwd: process.cwd(), stdio: "pipe" });
  const root = mkdtempSync(join(tmpdir(), "pipedrive-mcp-release-assets-test-"));
  const remote = join(root, "distribution.git");
  const seed = join(root, "seed");
  const fakeBin = join(root, "bin");
  const fakeGhState = join(root, "gh-state");
  const fakeGh = join(fakeBin, "gh");
  const gitIdentity = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    FAKE_GH_STATE: fakeGhState,
    GIT_AUTHOR_NAME: "Pipedrive MCP Tests",
    GIT_AUTHOR_EMAIL: "tests@example.invalid",
    GIT_COMMITTER_NAME: "Pipedrive MCP Tests",
    GIT_COMMITTER_EMAIL: "tests@example.invalid",
  };

  try {
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      fakeGh,
      `#!/bin/sh
set -eu
assets="$FAKE_GH_STATE/assets"
case "$1:$2" in
  release:view)
    if [ ! -d "$assets" ]; then
      echo "release not found" >&2
      exit 1
    fi
    printf '{"tagName":"v${packageVersion}","assets":['
    first=1
    for file in "$assets"/*; do
      [ -e "$file" ] || continue
      if [ "$first" -eq 0 ]; then printf ','; fi
      first=0
      printf '{"name":"%s"}' "$(basename "$file")"
    done
    printf ']}\\n'
    ;;
  release:create)
    mkdir -p "$assets"
    ;;
  release:upload)
    mkdir -p "$assets"
    cp "$4" "$assets/$(basename "$4")"
    ;;
  release:download)
    pattern=""
    destination=""
    shift 3
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --pattern) pattern="$2"; shift 2 ;;
        --dir) destination="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    mkdir -p "$destination"
    cp "$assets/$pattern" "$destination/$pattern"
    ;;
  *)
    echo "unexpected gh invocation: $*" >&2
    exit 2
    ;;
esac
`,
      "utf8",
    );
    chmodSync(fakeGh, 0o755);

    execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { stdio: "pipe" });
    mkdirSync(seed);
    execFileSync("git", ["init", "--initial-branch=main"], { cwd: seed, stdio: "pipe" });
    writeFileSync(join(seed, "README.md"), "seed\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: seed, env: gitIdentity, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "seed"], { cwd: seed, env: gitIdentity, stdio: "pipe" });
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: seed, stdio: "pipe" });
    execFileSync("git", ["push", "-u", "origin", "main"], { cwd: seed, stdio: "pipe" });

    const publishArgs = [
      "scripts/release-claude-plugin.mjs",
      "--publish",
      "--distribution-git-url",
      remote,
      "--release-repo",
      "example/pipedrive-mcp",
      "--skip-check",
      "--skip-remote-verify",
    ];
    execFileSync("node", publishArgs, { cwd: process.cwd(), env: gitIdentity, stdio: "pipe" });
    const publishedAssets = readdirSync(join(fakeGhState, "assets"));
    assert.equal(publishedAssets.length, 17);
    assert.equal(publishedAssets.includes(`pipedrive-mcp-${packageVersion}.mcpb`), true);
    assert.equal(publishedAssets.includes(`pipedrive-add-note-${packageVersion}.zip`), true);

    execFileSync("node", publishArgs, { cwd: process.cwd(), env: gitIdentity, stdio: "pipe" });

    const tamperedText = join(root, "tampered.txt");
    const tamperedAsset = join(fakeGhState, "assets", `pipedrive-add-note-${packageVersion}.zip`);
    writeFileSync(tamperedText, "tampered\n", "utf8");
    rmSync(tamperedAsset, { force: true });
    execFileSync("zip", ["-qj", tamperedAsset, tamperedText], { stdio: "pipe" });
    assert.throws(
      () => execFileSync("node", publishArgs, { cwd: process.cwd(), env: gitIdentity, stdio: "pipe" }),
      /already exists with different content/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude plugin release script rejects ambiguous boolean and unknown options", () => {
  assert.throws(
    () => execFileSync("node", ["scripts/release-claude-plugin.mjs", "--publish", "false"], { cwd: process.cwd(), stdio: "pipe" }),
    /does not accept a value/,
  );
  assert.throws(
    () => execFileSync("node", ["scripts/release-claude-plugin.mjs", "--unknown"], { cwd: process.cwd(), stdio: "pipe" }),
    /Unknown option/,
  );
  assert.throws(
    () =>
      execFileSync(
        "node",
        ["scripts/release-claude-plugin.mjs", "--publish", "--distribution-git-branch", "staging", "--skip-check"],
        { cwd: process.cwd(), stdio: "pipe" },
      ),
    /non-main distribution branch is forbidden/,
  );
  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/release-claude-plugin.mjs",
          "--publish",
          "--skip-release-assets",
          "--skip-remote-verify",
          "--skip-check",
        ],
        { cwd: process.cwd(), stdio: "pipe" },
      ),
    /main distribution branch is forbidden/,
  );
  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/release-claude-plugin.mjs",
          "--publish",
          "--distribution-git-branch",
          "staging",
          "--skip-release-assets",
          "--skip-check",
        ],
        { cwd: process.cwd(), stdio: "pipe" },
      ),
    /requires --skip-remote-verify/,
  );
});

test("legacy bridge cleanup guidance pins the v0.1.6 managed-entry marker", () => {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), "tests", "fixtures", "claude-desktop-config-v0.1.6.json"), "utf8"),
  );
  assert.equal(
    fixture.mcpServers.pipedrive.env.PIPEDRIVE_MANAGED_BY_PIPEDRIVE_MCP_EXTENSION,
    "true",
  );
  const troubleshooting = readFileSync(join(process.cwd(), "docs", "TROUBLESHOOTING.md"), "utf8");
  assert.match(troubleshooting, /PIPEDRIVE_MANAGED_BY_PIPEDRIVE_MCP_EXTENSION/);
  assert.match(troubleshooting, /Do not remove an unmarked Pipedrive entry/);
});

function assertInstallableDistributionPlugin(distributionRoot: string) {
  const pluginRoot = join(distributionRoot, "plugin");
  assert.equal(existsSync(join(pluginRoot, ".claude-plugin", "plugin.json")), true);
  assert.equal(existsSync(join(pluginRoot, ".mcp.json")), true);
  assert.deepEqual(readdirSync(join(pluginRoot, "skills")).sort(), expectedSkillNames);
  for (const skillName of expectedSkillNames) {
    assert.equal(existsSync(join(pluginRoot, "skills", skillName, "SKILL.md")), true);
  }

  for (const file of walk(pluginRoot)) {
    const relativePath = file.slice(pluginRoot.length + 1);
    assert.doesNotMatch(relativePath, /\.(?:zip|mcpb|tgz|tar|gz)$/i);
    const header = readFileSync(file).subarray(0, 4).toString("hex");
    assert.equal(["504b0304", "504b0506", "504b0708"].includes(header), false, relativePath);
  }
}

function assertArchiveFreeDistribution(distributionRoot: string) {
  for (const file of walk(distributionRoot)) {
    const relativePath = file.slice(distributionRoot.length + 1);
    if (relativePath === ".git" || relativePath.startsWith(".git/")) {
      continue;
    }
    assert.doesNotMatch(relativePath, /\.(?:zip|mcpb|tgz|tar|gz)$/i);
    const header = readFileSync(file).subarray(0, 4).toString("hex");
    assert.equal(["504b0304", "504b0506", "504b0708"].includes(header), false, relativePath);
  }
}

async function listTools(serverPath: string, cwd: string, overrides: Record<string, string | undefined> = {}) {
  const client = new Client({ name: "plugin-smoke", version: "0.1.0" });
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    PIPEDRIVE_LOAD_DOTENV: "false",
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
    PIPEDRIVE_API_TOKEN: "test-token",
    PIPEDRIVE_ENABLE_WRITES: "false",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd,
    env,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

function assertReadOnlyProfile(tools: string[]) {
  assert.equal(tools.length, readOnlyToolCount);
  assert.equal(tools.includes("pipedrive_health_check"), true);
  assert.equal(tools.includes("pipedrive_mailbox_probe"), false);
  assert.equal(tools.includes("pipedrive_delete_deal"), false);
  assert.equal(tools.includes("pipedrive_create_deal"), false);
}

function readMcpbManifest(path: string) {
  return JSON.parse(execFileSync("unzip", ["-p", path, "manifest.json"], { encoding: "utf8" }));
}

function normalizedZipDigest(path: string): string {
  const digest = createHash("sha256");
  for (const member of listZipMembers(path).filter((name) => !name.endsWith("/")).sort()) {
    digest.update(member);
    digest.update("\0");
    digest.update(createHash("sha256").update(execFileSync("unzip", ["-p", path, member])).digest("hex"));
    digest.update("\n");
  }
  return digest.digest("hex");
}

function listZipMembers(path: string): string[] {
  return execFileSync("unzip", ["-Z1", path], { encoding: "utf8" })
    .split("\n")
    .map((member) => member.trim())
    .filter(Boolean);
}

function gitCommitCount(remote: string, branch = "main"): number {
  return Number(execFileSync("git", ["--git-dir", remote, "rev-list", "--count", branch], { encoding: "utf8" }).trim());
}
