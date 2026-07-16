import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, requireConfigured } from "../src/config.js";
import { getRuntimeEnvDiagnostics, loadRuntimeEnv } from "../src/env.js";

test("loads production-safe defaults without a token", () => {
  const config = loadConfig({});
  assert.equal(config.apiToken, undefined);
  assert.equal(config.accessToken, undefined);
  assert.equal(config.companyDomain, undefined);
  assert.equal(config.baseUrl, "");
  assert.equal(config.baseUrlSource, "missing");
  assert.equal(config.allowMockBaseUrl, false);
  assert.equal(config.enableWrites, false);
  assert.equal(config.enableDeleteTools, false);
  assert.equal(config.enableMailboxTools, false);
  assert.equal(config.requestTimeoutMs, 10000);
});

test("derives the base URL from the company domain", () => {
  const config = loadConfig({
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
    PIPEDRIVE_API_TOKEN: "token",
    PIPEDRIVE_ENABLE_WRITES: "true",
    PIPEDRIVE_ENABLE_DELETE_TOOLS: "true",
    PIPEDRIVE_ENABLE_MAILBOX_TOOLS: "true",
  });
  assert.equal(config.companyDomain, "acme");
  assert.equal(config.baseUrl, "https://acme.pipedrive.com");
  assert.equal(config.baseUrlSource, "company_domain");
  assert.equal(config.enableWrites, true);
  assert.equal(config.enableDeleteTools, true);
  assert.equal(config.enableMailboxTools, true);
});

test("normalizes common Pipedrive domain and base URL inputs", () => {
  const fromFullCompanyUrl = loadConfig({
    PIPEDRIVE_COMPANY_DOMAIN: "https://acme.pipedrive.com/",
    PIPEDRIVE_API_TOKEN: "token",
  });
  assert.equal(fromFullCompanyUrl.companyDomain, "acme");
  assert.equal(fromFullCompanyUrl.baseUrl, "https://acme.pipedrive.com");
  assert.equal(fromFullCompanyUrl.baseUrlSource, "company_domain");
  assert.doesNotThrow(() => requireConfigured(fromFullCompanyUrl));

  const fromCompanyHost = loadConfig({
    PIPEDRIVE_COMPANY_DOMAIN: "acme.pipedrive.com",
    PIPEDRIVE_API_TOKEN: "token",
  });
  assert.equal(fromCompanyHost.companyDomain, "acme");
  assert.equal(fromCompanyHost.baseUrl, "https://acme.pipedrive.com");
  assert.doesNotThrow(() => requireConfigured(fromCompanyHost));

  const fromShortBaseUrl = loadConfig({
    PIPEDRIVE_BASE_URL: "acme",
    PIPEDRIVE_API_TOKEN: "token",
  });
  assert.equal(fromShortBaseUrl.baseUrl, "https://acme.pipedrive.com");
  assert.equal(fromShortBaseUrl.baseUrlSource, "explicit");
  assert.doesNotThrow(() => requireConfigured(fromShortBaseUrl));

  const fromBaseUrlHost = loadConfig({
    PIPEDRIVE_BASE_URL: "acme.pipedrive.com/",
    PIPEDRIVE_API_TOKEN: "token",
  });
  assert.equal(fromBaseUrlHost.baseUrl, "https://acme.pipedrive.com");
  assert.equal(fromBaseUrlHost.baseUrlSource, "explicit");
  assert.doesNotThrow(() => requireConfigured(fromBaseUrlHost));
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

test("loads only the local dotenv file", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv();
  try {
    writeFileSync(join(packageDir, "..", ".env"), "PIPEDRIVE_ENABLE_WRITES=true\n", "utf-8");
    writeFileSync(join(packageDir, ".env"), "PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true\n", "utf-8");

    loadRuntimeEnv({ packageDir, env });
    const diagnostics = getRuntimeEnvDiagnostics();

    assert.equal(env.PIPEDRIVE_ENABLE_WRITES, undefined);
    assert.equal(env.PIPEDRIVE_ENABLE_MAILBOX_TOOLS, "true");
    assert.equal(diagnostics.initialized, true);
    assert.equal(diagnostics.dotenvLoadingEnabled, true);
    assert.equal(diagnostics.dotenvLocalFilePresent, true);
    assert.equal(diagnostics.dotenvLoaded, true);
    assert.equal(diagnostics.preexisting.enableMailboxTools, false);
    assert.equal(diagnostics.current.enableMailboxTools, true);
  } finally {
    cleanup();
  }
});

test("starts without dotenv when no local dotenv file exists", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv({
    PIPEDRIVE_LOAD_DOTENV: "true",
    PIPEDRIVE_COMPANY_DOMAIN: "acme",
  });
  try {
    assert.doesNotThrow(() => loadRuntimeEnv({ packageDir, env }));
    const diagnostics = getRuntimeEnvDiagnostics();
    assert.equal(diagnostics.dotenvLoadingEnabled, true);
    assert.equal(diagnostics.dotenvLocalFilePresent, false);
    assert.equal(diagnostics.dotenvLoaded, false);
    assert.equal(env.PIPEDRIVE_COMPANY_DOMAIN, "acme");
  } finally {
    cleanup();
  }
});

test("does not override env values already supplied by the process", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv({
    PIPEDRIVE_ENABLE_WRITES: "true",
  });
  try {
    writeFileSync(join(packageDir, ".env"), "PIPEDRIVE_ENABLE_WRITES=false\n", "utf-8");

    loadRuntimeEnv({ packageDir, env });
    const diagnostics = getRuntimeEnvDiagnostics();

    assert.equal(env.PIPEDRIVE_ENABLE_WRITES, "true");
    assert.equal(diagnostics.preexisting.enableWrites, true);
    assert.equal(diagnostics.current.enableWrites, true);
  } finally {
    cleanup();
  }
});

test("can skip dotenv loading for controlled environments", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv({
    PIPEDRIVE_LOAD_DOTENV: "FALSE",
  });
  try {
    writeFileSync(join(packageDir, ".env"), "PIPEDRIVE_ENABLE_WRITES=true\n", "utf-8");

    loadRuntimeEnv({ packageDir, env });
    const diagnostics = getRuntimeEnvDiagnostics();

    assert.equal(env.PIPEDRIVE_ENABLE_WRITES, undefined);
    assert.equal(diagnostics.initialized, true);
    assert.equal(diagnostics.dotenvLoadingEnabled, false);
    assert.equal(diagnostics.dotenvLocalFilePresent, false);
    assert.equal(diagnostics.dotenvLoaded, false);
    assert.equal(diagnostics.preexisting.loadDotenv, true);
    assert.equal(diagnostics.current.loadDotenv, true);
  } finally {
    cleanup();
  }
});

test("runtime env diagnostics are returned as a defensive copy", () => {
  const { env, packageDir, cleanup } = temporaryPackageEnv();
  try {
    writeFileSync(join(packageDir, ".env"), "PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true\n", "utf-8");
    loadRuntimeEnv({ packageDir, env });

    const first = getRuntimeEnvDiagnostics();
    first.dotenvLoaded = false;
    first.current.enableMailboxTools = false;

    const second = getRuntimeEnvDiagnostics();
    assert.equal(second.dotenvLoaded, true);
    assert.equal(second.current.enableMailboxTools, true);
  } finally {
    cleanup();
  }
});

test("reports an unreadable local dotenv path without preventing startup", () => {
  const { packageDir, cleanup } = temporaryPackageEnv();
  try {
    mkdirSync(join(packageDir, ".env"));

    assert.doesNotThrow(() => loadRuntimeEnv({ packageDir, env: {} }));
    const diagnostics = getRuntimeEnvDiagnostics();
    assert.equal(diagnostics.initialized, true);
    assert.equal(diagnostics.dotenvLocalFilePresent, true);
    assert.equal(diagnostics.dotenvLoaded, false);
    assert.equal(diagnostics.dotenvLoadFailed, true);
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
  const rootDir = mkdtempSync(join(tmpdir(), "pipedrive-mcp-"));
  const packageDir = join(rootDir, "pipedrive-mcp");
  mkdirSync(packageDir);
  return {
    env: { ...initialEnv },
    packageDir,
    cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
  };
}
