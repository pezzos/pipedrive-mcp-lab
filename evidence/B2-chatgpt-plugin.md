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
- ID boundary: `remote_plugin_id` is exactly
  `plugin_asdk_app_6a5f066a2b788191b7694a13343b6da0`; `app_id` is exactly
  `asdk_app_6a5f066a2b788191b7694a13343b6da0`. Only `app_id` is emitted in
  `.app.json`; there is no lifecycle transformation between the two.
  Derived locally from the official created-by-me remote plugin cache,
  `.codex-remote-plugin-install.json` supplied `remote_plugin_id` and its
  cached `.app.json` supplied `app_id`; both are resource identifiers, not
  credentials.
  This is a subsequent B3 prerequisite correction to the original `ce00096`
  B2 artifact evidence, not a claim that the original artifact already had the
  corrected two-ID model.

## Deferred external acceptance

The resource reference is intentionally committed because it is an app resource
ID, not a credential. The app is still disconnected. Endpoint/OAuth discovery
does not prove a connection, available action, pilot installation, or tool
success. B3 owns only isolated local install, update, disable, enable,
uninstall, and reinstall acceptance. B8 owns the external connection,
authentication, action, tool discovery, and first safe read.

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
