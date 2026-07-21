# B2 ChatGPT Plugin Evidence

## Scope

This evidence records the local/private package implementation for **Pipedrive
Sandbox** version `0.3.4`. It is not evidence of installation, OAuth,
Cloudflare Access acceptance, ChatGPT tool discovery, CRM access, or a live
Pipedrive action.

## Contract

- Package source: `plugin/chatgpt/plugin-source.json`
- The tracked source contract freezes the exact sandbox endpoint; the generated
  package deliberately omits a direct URL and MCP configuration.
- Canonical workflows: the exact seven tracked `plugin/claude/skills/*/SKILL.md`
  files
- Output: `dist/chatgpt-plugin/pipedrive-sandbox-0.3.4/` plus its SHA-256
  receipt
- Package contents: exactly ten text files (marketplace, plugin manifest, app
  manifest, seven skills)
- Marketplace and plugin manifests use the local app-backed metadata shapes;
  starter prompts are supported plugin interface metadata, not marketplace
  listing fields.
- App manifest: one required `Pipedrive Sandbox` app resource; no direct MCP
  server declaration. The remote app resource, not the package, encapsulates
  the endpoint.

## Deferred external acceptance

The resource reference is intentionally committed because it is an app resource
ID, not a credential. The app is still disconnected. Endpoint/OAuth discovery
does not prove a connection, available action, pilot installation, or tool
success. B3 owns the connection/action lifecycle and B8 owns external
acceptance.

## Review result

The workflow-specialist's two medium findings were remediated: the artifact and
receipt now replace as a recoverable pair, and the generated artifact's
app-backed URL boundary is explicit. Original Sol's four findings were also
remediated and received final PASS. No unresolved local B2 finding remains;
this does not constitute external installation, connection, action, or CRM
acceptance.

## Local verification

- `npm run pack:chatgpt-plugin` — passed; staged the ten-file package and
  deterministic receipt as a recoverable pair.
- `node --import tsx --test tests/chatgptPluginSmoke.test.ts tests/pluginSmoke.test.ts`
  — passed (19 tests), including isolated-root byte/content/mode and receipt
  equality, canonical-set rejection, plus a controlled post-install failure
  that restores the prior artifact and receipt with no staging or backup residue.
- `npm run pack:claude-delivery` — passed; canonical skill compatibility
  delivery remains byte-aligned.
- `WRANGLER_SEND_METRICS=false npm run build:worker` — passed (dry run only).
- `WRANGLER_SEND_METRICS=false npm run check` — passed (124 tests).
- `npm run benchmark:server` — passed, p95 `3.383ms` (limit `20ms`).
- `npm pack --dry-run --json` — passed for `pipedrive-mcp@0.3.4`.
- `npm audit --audit-level=high --offline` — passed with zero vulnerabilities;
  this is cache-backed and not a fresh registry audit.
- `git diff --check` — passed.
