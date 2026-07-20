import assert from "node:assert/strict";
import test from "node:test";
import { remoteOAuthErrorMessage } from "../src/remote/oauthErrors.js";

test("routes user-owned OAuth recovery to the user connection page", () => {
  for (const code of [
    "oauth_authorization_denied",
    "oauth_state_invalid",
    "oauth_code_invalid",
    "pipedrive_reconnect_required",
    "oauth_material_invalid",
  ] as const) {
    const message = remoteOAuthErrorMessage(code);
    assert.match(message, /votre page de connexion Pipedrive/i);
    assert.doesNotMatch(message, /page d’administration/i);
  }
});
