import assert from "node:assert/strict";
import test from "node:test";

import { renderSettingsPage } from "../src/remote/settingsPage.js";

test("renders an accessible per-user settings form without leaking markup", () => {
  const page = renderSettingsPage({
    email: 'user@example.com"><script>alert(1)</script>',
    csrf: "csrf-fixture",
    nonce: "nonce-fixture",
    saved: true,
    policy: {
      writes: true,
      deletes: false,
      mailbox: true,
      revision: 3,
      updatedAt: "2026-07-15T00:00:00.000Z",
    },
  });
  assert.match(page, /lang="fr"/);
  assert.match(page, /<fieldset>/);
  assert.match(page, /name="writes" value="yes" checked/);
  assert.match(page, /name="mailbox" value="yes" checked/);
  assert.doesNotMatch(page, /name="deletes" value="yes" checked/);
  assert.match(page, /role="status"/);
  assert.match(page, /prefers-reduced-motion/);
  assert.match(page, /style nonce="nonce-fixture"/);
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /&lt;script&gt;alert/);
});
