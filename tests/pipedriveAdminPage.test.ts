import assert from "node:assert/strict";
import test from "node:test";

import {
  renderApproveConfirmation,
  renderAdminActionConfirmation,
  renderPipedriveAdminPage,
} from "../src/remote/pipedriveAdminPage.js";
import { renderUserConnectionPage } from "../src/remote/userConnectionPage.js";

test("admin page renders only bounded token-free tenant and Access metadata", () => {
  const page = renderPipedriveAdminPage({
    projection: {
      tenants: [{
        domain: "acme",
        status: "active",
        tenantId: "tenant-opaque",
        generation: 2,
        createdAtMs: 1,
        updatedAtMs: 2,
        companyId: "42",
        companyName: 'Acme <script>alert("company")</script>',
        connectedUserCount: 1,
      }],
      connections: [{
        connectionRef: "connection-opaque",
        accessEmail: 'user+<img>@example.test',
        domain: "acme",
        state: "connected",
        generation: 3,
        connectedAtMs: Date.UTC(2026, 6, 16),
      }],
    },
    nonce: "nonce-fixture",
  });

  assert.match(page, /style nonce="nonce-fixture"/);
  assert.match(page, /Acme &lt;script&gt;alert/);
  assert.match(page, /user\+&lt;img&gt;@example\.test/);
  assert.match(page, /action="\/admin\/pipedrive\/action\/confirm"/);
  assert.match(page, /Forcer la déconnexion/);
  assert.doesNotMatch(page, /<script>|access_token|refresh_token|Pipedrive user/);
  assert.doesNotMatch(page, /tenant-opaque/);
});

test("admin page uses valid empty table rows and a separate approval confirmation", () => {
  const empty = renderPipedriveAdminPage({
    projection: { tenants: [], connections: [] },
    nonce: "nonce",
  });
  assert.match(empty, /<tbody><tr><td colspan="6">Aucun domaine/);
  assert.doesNotMatch(empty, /<tbody><p>/);

  const confirmation = renderApproveConfirmation({
    domain: "acme",
    actionToken: "one-shot-token",
    nonce: "nonce",
  });
  assert.match(confirmation, /Confirmer l’approbation/);
  assert.match(confirmation, /name="confirm" value="yes"/);
  assert.match(confirmation, /one-shot-token/);

  const actionConfirmation = renderAdminActionConfirmation({
    action: "force-disconnect",
    target: 'connection"><script>',
    actionToken: 'one-shot"><script>',
    nonce: "nonce",
  });
  assert.match(actionConfirmation, /action="\/admin\/pipedrive\/force-disconnect"/);
  assert.match(actionConfirmation, /name="confirm" value="yes"/);
  assert.doesNotMatch(actionConfirmation, /<script>/);
});

test("user page distinguishes connect, replace, reconnect and local disconnect safely", () => {
  const connected = renderUserConnectionPage({
    status: {
      connected: true,
      reconnectRequired: false,
      generation: 3,
      domain: "acme",
      companyId: "42",
      companyName: 'Acme <img src="x">',
      expiresAtMs: Date.now() + 60_000,
    },
    actionToken: 'csrf"><script>',
    nonce: "nonce",
    connected: false,
    disconnected: false,
  });
  assert.match(connected, /Remplacer la connexion/);
  assert.match(connected, /Déconnecter mon compte/);
  assert.match(connected, /ne révoque pas l’application/);
  assert.match(connected, /Acme &lt;img src=&quot;x&quot;&gt;/);
  assert.doesNotMatch(connected, /<script>|<img/);

  const purged = renderUserConnectionPage({
    status: {
      connected: false,
      reconnectRequired: true,
      generation: 4,
      domain: "acme",
      companyId: "42",
      companyName: "Acme",
    },
    actionToken: "unused",
    nonce: "nonce",
    connected: false,
    disconnected: false,
  });
  assert.match(purged, /Reconnexion requise/);
  assert.match(purged, /Connecter Pipedrive/);
  assert.doesNotMatch(purged, /Déconnecter mon compte/);
  assert.doesNotMatch(purged, /href="\/settings"/);
});
