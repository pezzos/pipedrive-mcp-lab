import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, requireConfigured } from "../src/config.js";
import { getRuntimeEnvDiagnostics, loadRuntimeEnv } from "../src/env.js";

test("loads safe defaults without a token", () => {
  const config = loadConfig({});
  assert.equal(config.apiToken, undefined);
  assert.equal(config.accessToken, undefined);
  assert.equal(config.companyDomain, undefined);
  assert.equal(config.baseUrl, "");
  assert.equal(config.allowMockBaseUrl, false);
  assert.equal(config.enableWrites, false);
  assert.equal(config.requireWriteConfirmation, true);
  assert.equal(config.allowLabWriteConfirmation, true);
  assert.equal(config.requireLabPrefix, true);
  assert.equal(config.labPrefix, "MCP LAB -");
  assert.equal(config.writeConfirmation, "CONFIRM_WRITE");
  assert.equal(config.requestTimeoutMs, 10000);
});

test("derives the base URL from the company domain", () => {
  const config = loadConfig({
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
    PIPEDRIVE_API_TOKEN: "token",
    PIPEDRIVE_ENABLE_WRITES: "true",
  });
  assert.equal(config.baseUrl, "https://acme.pipedrive.com");
  assert.equal(config.enableWrites, true);
});

test("accepts an OAuth access token instead of an API token", () => {
  const config = loadConfig({
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
    PIPEDRIVE_ACCESS_TOKEN: "oauth-token",
  });
  assert.equal(config.apiToken, undefined);
  assert.equal(config.accessToken, "oauth-token");
  assert.doesNotThrow(() => requireConfigured(config));
});

test("can explicitly disable write confirmation for production operation", () => {
  const config = loadConfig({
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
    PIPEDRIVE_API_TOKEN: "token",
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_REQUIRE_WRITE_CONFIRMATION: "false",
  });
  assert.equal(config.enableWrites, true);
  assert.equal(config.requireWriteConfirmation, false);
});

test("loads runtime env from parent dotenv when local dotenv is absent", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv();
  try {
    writeFileSync(join(packageDir, "..", ".env"), "PIPEDRIVE_REQUIRE_LAB_PREFIX=false\n", "utf-8");

    loadRuntimeEnv({ packageDir, env });
    const diagnostics = getRuntimeEnvDiagnostics();

    assert.equal(env.PIPEDRIVE_REQUIRE_LAB_PREFIX, "false");
    assert.equal(diagnostics.initialized, true);
    assert.equal(diagnostics.dotenvLoadingEnabled, true);
    assert.equal(diagnostics.dotenvLocalFilePresent, false);
    assert.equal(diagnostics.dotenvParentFilePresent, true);
    assert.equal(diagnostics.dotenvLoaded, true);
    assert.equal(diagnostics.preexisting.requireLabPrefix, false);
    assert.equal(diagnostics.current.requireLabPrefix, true);
  } finally {
    cleanup();
  }
});

test("does nothing when no runtime dotenv file exists", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv();
  try {
    assert.doesNotThrow(() => loadRuntimeEnv({ packageDir, env }));
    assert.deepEqual(env, {});
  } finally {
    cleanup();
  }
});

test("loads local dotenv before parent dotenv while preserving parent-only values", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv();
  try {
    writeFileSync(
      join(packageDir, "..", ".env"),
      "PIPEDRIVE_REQUIRE_LAB_PREFIX=false\nPIPEDRIVE_LAB_PREFIX=ROOT LAB -\nPIPEDRIVE_ENABLE_WRITES=true\n",
      "utf-8",
    );
    writeFileSync(join(packageDir, ".env"), "PIPEDRIVE_LAB_PREFIX=LOCAL LAB -\n", "utf-8");

    loadRuntimeEnv({ packageDir, env });
    const diagnostics = getRuntimeEnvDiagnostics();

    assert.equal(env.PIPEDRIVE_REQUIRE_LAB_PREFIX, "false");
    assert.equal(env.PIPEDRIVE_LAB_PREFIX, "LOCAL LAB -");
    assert.equal(env.PIPEDRIVE_ENABLE_WRITES, "true");
    assert.equal(diagnostics.dotenvLocalFilePresent, true);
    assert.equal(diagnostics.dotenvParentFilePresent, true);
    assert.equal(diagnostics.dotenvLoaded, true);
    assert.equal(diagnostics.preexisting.enableWrites, false);
    assert.equal(diagnostics.current.enableWrites, true);
  } finally {
    cleanup();
  }
});

test("runtime dotenv values flow into default process config loading", () => {
  const { packageDir, cleanup } = temporaryPackageEnv();
  const original = process.env.PIPEDRIVE_REQUIRE_LAB_PREFIX;
  try {
    delete process.env.PIPEDRIVE_REQUIRE_LAB_PREFIX;
    writeFileSync(join(packageDir, "..", ".env"), "PIPEDRIVE_REQUIRE_LAB_PREFIX=false\n", "utf-8");

    loadRuntimeEnv({ packageDir });

    assert.equal(loadConfig().requireLabPrefix, false);
  } finally {
    if (original === undefined) {
      delete process.env.PIPEDRIVE_REQUIRE_LAB_PREFIX;
    } else {
      process.env.PIPEDRIVE_REQUIRE_LAB_PREFIX = original;
    }
    cleanup();
  }
});

test("does not override env values already supplied by the process", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv({
    PIPEDRIVE_REQUIRE_LAB_PREFIX: "true",
  });
  try {
    writeFileSync(join(packageDir, "..", ".env"), "PIPEDRIVE_REQUIRE_LAB_PREFIX=false\n", "utf-8");
    writeFileSync(join(packageDir, ".env"), "PIPEDRIVE_REQUIRE_LAB_PREFIX=false\n", "utf-8");

    loadRuntimeEnv({ packageDir, env });
    const diagnostics = getRuntimeEnvDiagnostics();

    assert.equal(env.PIPEDRIVE_REQUIRE_LAB_PREFIX, "true");
    assert.equal(diagnostics.preexisting.requireLabPrefix, true);
    assert.equal(diagnostics.current.requireLabPrefix, true);
  } finally {
    cleanup();
  }
});

test("can skip dotenv loading for controlled test environments", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv({
    PIPEDRIVE_LOAD_DOTENV: "FALSE",
  });
  try {
    writeFileSync(join(packageDir, "..", ".env"), "PIPEDRIVE_REQUIRE_LAB_PREFIX=false\n", "utf-8");

    loadRuntimeEnv({ packageDir, env });
    const diagnostics = getRuntimeEnvDiagnostics();

    assert.equal(env.PIPEDRIVE_REQUIRE_LAB_PREFIX, undefined);
    assert.equal(diagnostics.dotenvLoadingEnabled, false);
    assert.equal(diagnostics.dotenvLoaded, false);
    assert.equal(diagnostics.preexisting.loadDotenv, true);
    assert.equal(diagnostics.current.requireLabPrefix, false);
  } finally {
    cleanup();
  }
});

test("runtime env diagnostics are returned as a defensive copy", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv();
  try {
    writeFileSync(join(packageDir, "..", ".env"), "PIPEDRIVE_REQUIRE_LAB_PREFIX=false\n", "utf-8");
    loadRuntimeEnv({ packageDir, env });

    const first = getRuntimeEnvDiagnostics();
    first.dotenvLoaded = false;
    first.current.requireLabPrefix = false;

    const second = getRuntimeEnvDiagnostics();
    assert.equal(second.dotenvLoaded, true);
    assert.equal(second.current.requireLabPrefix, true);
  } finally {
    cleanup();
  }
});

test("throws when an existing dotenv path cannot be loaded", () => {
  const { packageDir, cleanup } = temporaryPackageEnv();
  try {
    mkdirSync(join(packageDir, ".env"));

    assert.throws(() => loadRuntimeEnv({ packageDir, env: {} }), /Failed to load runtime \.env file/);
  } finally {
    cleanup();
  }
});

test("requires token and base url before live API calls", () => {
  assert.throws(() => requireConfigured(loadConfig({})), /PIPEDRIVE_API_TOKEN or PIPEDRIVE_ACCESS_TOKEN/);
});

test("rejects non-Pipedrive base URLs unless mock override is explicit", () => {
  const unsafe = loadConfig({
    PIPEDRIVE_BASE_URL: "http://127.0.0.1:3000",
    PIPEDRIVE_API_TOKEN: "token",
  });
  assert.throws(() => requireConfigured(unsafe), /PIPEDRIVE_BASE_URL/);

  const mock = loadConfig({
    PIPEDRIVE_BASE_URL: "http://127.0.0.1:3000",
    PIPEDRIVE_API_TOKEN: "token",
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
  });
  assert.doesNotThrow(() => requireConfigured(mock));

  const hostile = loadConfig({
    PIPEDRIVE_BASE_URL: "https://example.invalid",
    PIPEDRIVE_API_TOKEN: "token",
    PIPEDRIVE_ALLOW_MOCK_BASE_URL: "true",
  });
  assert.throws(() => requireConfigured(hostile), /PIPEDRIVE_BASE_URL/);
});

function temporaryPackageEnv(initialEnv: NodeJS.ProcessEnv = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), "pipedrive-mcp-lab-"));
  const packageDir = join(rootDir, "pipedrive-mcp-lab");
  mkdirSync(packageDir);
  return {
    env: { ...initialEnv },
    packageDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}
