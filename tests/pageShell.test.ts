import assert from "node:assert/strict";
import test from "node:test";

import { renderPageShell } from "../src/remote/pageShell.js";

test("shared shell keeps all executable styling nonce-bound and uses no remote assets", () => {
  const page = renderPageShell({ title: '<title>', nonce: 'nonce"><script>', children: "<h1>OK</h1>" });
  assert.match(page, /style nonce="nonce&quot;&gt;&lt;script&gt;"/);
  assert.match(page, /oklch/);
  assert.doesNotMatch(page, /<script|<img|https?:\/\//);
  assert.match(page, /min-height:2\.75rem/);
});
