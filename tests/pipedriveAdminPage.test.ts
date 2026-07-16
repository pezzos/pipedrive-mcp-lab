import assert from "node:assert/strict";
import test from "node:test";

import { renderPipedriveAdminPage } from "../src/remote/pipedriveAdminPage.js";

test("renders connected identity, CSP nonce inputs and explicit local disconnect copy safely", () => {
  const page = renderPipedriveAdminPage({
    connection: {
      connected: true,
      materialReadable: true,
      apiDomain: "https://acme.pipedrive.com",
      expiresAtMs: Date.UTC(2026, 6, 16, 12, 0),
    },
    identity: {
      state: "available",
      companyId: "42",
      companyName: 'Pezzos <script>alert("company")</script>',
      companyDomain: "pezzos-sandbox",
      userId: "7",
      userName: 'Admin <img src=x onerror="user">',
    },
    actionToken: 'csrf"><script>token()</script>',
    nonce: "nonce-fixture",
    connected: true,
    disconnected: false,
  });

  assert.match(page, /style nonce="nonce-fixture"/);
  assert.match(page, /Société/);
  assert.match(page, /Pezzos &lt;script&gt;alert/);
  assert.match(page, /Admin &lt;img src=x onerror=&quot;user&quot;&gt;/);
  assert.match(page, /Connexion enregistrée/);
  assert.match(page, /Remplacer la connexion/);
  assert.match(page, /name="confirm" value="yes"/);
  assert.match(page, /ne désinstalle pas l’application/);
  assert.match(page, /csrf&quot;&gt;&lt;script&gt;token\(\)&lt;\/script&gt;/);
  assert.match(page, /Connexion enregistrée<\/dt><dd>inconnue/);
  assert.doesNotMatch(page, /<script>|<img/);
  assert.doesNotMatch(page, /access_token|refresh_token|oauth-access|oauth-refresh/);
});

test("distinguishes disconnected and live-degraded states", () => {
  const disconnected = renderPipedriveAdminPage({
    connection: { connected: false },
    identity: { state: "unavailable" },
    actionToken: "csrf-fixture",
    nonce: "nonce-fixture",
    connected: false,
    disconnected: true,
  });
  assert.match(disconnected, /Déconnecté/);
  assert.match(disconnected, /Connecter Pipedrive/);
  assert.match(disconnected, /pipedrive_not_connected/);
  assert.doesNotMatch(disconnected, /Supprimer la connexion locale/);

  const degraded = renderPipedriveAdminPage({
    connection: {
      connected: true,
      materialReadable: true,
      apiDomain: "https://acme.pipedrive.com",
      expiresAtMs: Date.now() + 60_000,
      connectedAtMs: Date.now(),
    },
    identity: { state: "unavailable" },
    actionToken: "csrf-fixture",
    nonce: "nonce-fixture",
    connected: false,
    disconnected: false,
  });
  assert.match(degraded, /Connecté/);
  assert.match(degraded, /vérification en direct indisponible/);
  assert.match(degraded, /Cela ne prouve pas une déconnexion/);

  const unreadable = renderPipedriveAdminPage({
    connection: { connected: true, materialReadable: false },
    identity: { state: "unavailable" },
    actionToken: "csrf-unreadable-fixture",
    nonce: "nonce-fixture",
    connected: false,
    disconnected: false,
  });
  assert.match(unreadable, /Connexion inutilisable/);
  assert.match(unreadable, /jetons illisibles/);
  assert.match(unreadable, /Supprimer la connexion locale/);
  assert.match(unreadable, /name="csrf" value="csrf-unreadable-fixture"/);
});
