import assert from "node:assert/strict";
import test from "node:test";

import { renderUserConnectionPage } from "../src/remote/userConnectionPage.js";

test("user connection page uses only typed notices and states the local disconnect boundary", () => {
  const page = renderUserConnectionPage({
    status: { connected: true, reconnectRequired: false, generation: 3, domain: "a".repeat(63), companyId: "company".repeat(18), companyName: "S".repeat(160), expiresAtMs: 1 },
    actionToken: "token",
    nonce: "nonce",
    notice: "oauth-cancelled",
  });
  assert.match(page, /Votre connexion existante reste inchangée/);
  assert.match(page, /Worker/);
  assert.match(page, /ChatGPT/);
  assert.match(page, /Permissions/);
  assert.doesNotMatch(page, /<script|style=/);
});
