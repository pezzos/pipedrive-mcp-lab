import assert from "node:assert/strict";
import test from "node:test";
import { decryptMaterial, decryptMaterialWithSource, encryptMaterial } from "../src/remote/tenantSecrets.js";
import { loadRemoteConfig } from "../src/remote/env.js";

const primary = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const old = "__________________________________________8";
const material = { accessCredential: "access", refreshCredential: "refresh", expiresAtMs: 1, apiDomain: "https://acme.pipedrive.com" };
const env = () => ({ DEPLOY_ENVIRONMENT: "sandbox", PUBLIC_ORIGIN: "https://mcp.example.test", ACCESS_ISSUER: "https://access.example.test", ACCESS_AUD: "aud", REMOTE_ADMIN_EMAIL: "admin@example.test", REMOTE_ADMIN_SUB: "admin", PIPEDRIVE_OAUTH_CLIENT_ID: "client", PIPEDRIVE_OAUTH_CLIENT_SECRET: "secret", PIPEDRIVE_OAUTH_ENCRYPTION_KEY: primary, AUDIT_HMAC_KEY: old, PIPEDRIVE_OAUTH_CLIENT_EPOCH: "2026-Q3", PIPEDRIVE_OAUTH_ENCRYPTION_KID: "primary", AUDIT_HMAC_EPOCH: "2026-Q3" });

test("keyring routes current, old, and legacy OAuth envelopes", async () => {
  const keyring = { encryptionKey: primary, encryptionKid: "primary", oldEncryption: { key: old, kid: "old" } };
  const current = await encryptMaterial(material, keyring); assert.equal(current.kid, "primary"); assert.deepEqual(await decryptMaterial(current, keyring), material);
  const oldKid = await encryptMaterial(material, { encryptionKey: old, encryptionKid: "old" }); assert.deepEqual(await decryptMaterial(oldKid, keyring), material);
  assert.equal((await decryptMaterialWithSource(oldKid, keyring)).source, "old");
  assert.deepEqual(await decryptMaterial(await encryptMaterial(material, primary), keyring), material);
  const legacyOld = await encryptMaterial(material, old); assert.deepEqual(await decryptMaterial(legacyOld, keyring), material);
  assert.equal((await decryptMaterialWithSource(legacyOld, keyring)).source, "legacy-old");
  await assert.rejects(() => decryptMaterial({ ...current, kid: "unknown" }, keyring), /oauth_key_id_unknown/);
  await assert.rejects(() => decryptMaterial(current, { encryptionKey: old, encryptionKid: "primary" }), /oauth_material_invalid/);
});

test("rotation optional pairs fail closed", () => {
  assert.throws(() => loadRemoteConfig({ ...env(), PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID: "old" } as any), /PIPEDRIVE_OAUTH_OLD_ENCRYPTION/);
  assert.throws(() => loadRemoteConfig({ ...env(), PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID: "primary", PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KEY: old } as any), /PIPEDRIVE_OAUTH_OLD_ENCRYPTION_KID/);
});
