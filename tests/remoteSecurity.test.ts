import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAccessJwksCache,
  verifyAccessJwt,
  verifyAccessRequest,
} from "../src/remote/access.js";
import { normalizePipedriveApiDomain } from "../src/remote/apiDomain.js";
import { extractTargetIds, pseudonymizeAccessSub } from "../src/remote/audit.js";

const issuer = "https://team.cloudflareaccess.com";
const audience = "access-audience";

test("accepts a signed Access JWT and normalizes its identity", async () => {
  const fixture = await jwtFixture();
  const identity = await verifyAccessJwt(fixture.assertion, fixture.config);
  assert.deepEqual(identity, { sub: "access-user-1", email: "user@example.com" });
});

test("fails closed for missing assertions, invalid claims, and unavailable JWKS", async () => {
  await assert.rejects(
    verifyAccessRequest(new Request("https://example.test"), {
      issuer,
      audience,
      fetcher: async () => new Response("{}", { status: 500 }),
    }),
    /access_token_missing/,
  );

  const expired = await jwtFixture({ exp: 1 });
  await assert.rejects(
    verifyAccessJwt(expired.assertion, expired.config),
    /access_token_invalid/,
  );

  clearAccessJwksCache();
  const fixture = await jwtFixture();
  await assert.rejects(
    verifyAccessJwt(fixture.assertion, {
      ...fixture.config,
      fetcher: async () => new Response("unavailable", { status: 503 }),
    }),
    /access_jwks_unavailable/,
  );
});

test("rejects hostile Pipedrive API domains and returns an origin only", () => {
  assert.equal(
    normalizePipedriveApiDomain("https://acme.pipedrive.com/"),
    "https://acme.pipedrive.com",
  );
  for (const value of [
    "http://acme.pipedrive.com",
    "https://pipedrive.com.evil.test",
    "https://user@acme.pipedrive.com",
    "https://acme.pipedrive.com:8443",
    "https://acme.pipedrive.com/api/v1",
    "https://acme.pipedrive.com/?token=secret",
  ]) {
    assert.throws(() => normalizePipedriveApiDomain(value), /invalid_pipedrive_api_domain/);
  }
});

test("audit helpers keep only bounded identifiers and pseudonymize the actor", async () => {
  const sensitiveKey = `access_${"token"}`;
  assert.deepEqual(
    extractTargetIds({
      deal_id: 42,
      lead_id: "11111111-1111-4111-8111-111111111111",
      title: "must not be logged",
      [sensitiveKey]: "must not be logged",
      nested: { person_id: 7 },
    }),
    {
      deal_id: 42,
      lead_id: "11111111-1111-4111-8111-111111111111",
    },
  );
  const actor = await pseudonymizeAccessSub(
    "access-user-1",
    base64Url(Uint8Array.from({ length: 32 }, (_, index) => index)),
  );
  assert.equal(actor.length, 32);
  assert.equal(actor.includes("access-user-1"), false);
});

async function jwtFixture(overrides: Record<string, unknown> = {}) {
  clearAccessJwksCache();
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  Object.assign(publicJwk, { kid: "test-key", alg: "RS256", use: "sig" });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: [audience],
    exp: now + 300,
    iat: now - 5,
    nbf: now - 5,
    sub: "access-user-1",
    email: " User@Example.com ",
    ...overrides,
  };
  const header = base64Url(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
  const payload = base64Url(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const assertion = `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
  return {
    assertion,
    config: {
      issuer,
      audience,
      now: () => Date.now(),
      fetcher: async () => Response.json({ keys: [publicJwk] }),
    },
  };
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
