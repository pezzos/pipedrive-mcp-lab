import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig, requireConfigured } from "../src/config.js";

test("loads safe defaults without a token", () => {
  const config = loadConfig({});
  assert.equal(config.apiToken, undefined);
  assert.equal(config.companyDomain, undefined);
  assert.equal(config.baseUrl, "");
  assert.equal(config.enableWrites, false);
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

test("requires token and base url before live API calls", () => {
  assert.throws(() => requireConfigured(loadConfig({})), /PIPEDRIVE_API_TOKEN/);
});
