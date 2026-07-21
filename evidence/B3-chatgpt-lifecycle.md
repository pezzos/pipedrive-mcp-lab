# B3 ChatGPT Lifecycle Evidence

## Scope and boundary

Source commit: `ce00096dc202b800569404d4e96337d386354301`. The target is the
atomic commit containing this evidence. Codex CLI was `0.144.1`. The acceptance harness
uses generated `dist/chatgpt-lifecycle/profiles/<scenario>/` homes only and
executes actual local `plugin marketplace` and `plugin` commands. It has no
browser, real profile, credential, OAuth, Access, tool discovery, MCP call, or
CRM effect.

The receipt-bound release carries both immutable IDs: remote plugin install ID
`plugin_asdk_app_6a5f066a2b788191b7694a13343b6da0` and app resource ID
`asdk_app_6a5f066a2b788191b7694a13343b6da0`. The package has one required app
declaration and seven skills, with no direct MCP configuration. This B3 slice
includes the subsequent two-ID B2 dependency correction; it does not claim
that the original `ce00096` B2 artifact already carried that correction.

## Matrix

1. Clean generated profile installs through the local marketplace and plugin CLI.
2. Seven skills and one app declaration are structurally verified; no direct MCP registration.
3. Artifact, release, state, fixture, and plan are secret-free.
4. Managed local update preserves disabled state and replaces only owned content.
5. Disable/enable preserves cache, selection, and unrelated data.
6. Official local CLI uninstall removes owned selector/cache/state only.
7. Unrelated fixture bytes and modes remain identical around every operation.
8. Reinstall reaches the same normalized receipt tree state.
9. Injected same-name and same-URL MCP listings refuse before mutation.
10. Injected DNS/connect/timeout/5xx diagnostics guide network/VPN/Access retry;
    `invalid_client_metadata` classifies as `direct_mcp_registration_unaccepted`.
11. Receipt-verified standalone skills normalize duplicate/order input for subset
    and all selection; no connector is claimed usable.

Acceptance prints `primary_plugin_lifecycle: passed_actual_isolated` and
`direct_mcp_fallback: planned_fixture_only_external_b8`.

## Direct fallback and remaining gate

The exact secret-free plan is `codex mcp add pipedrive-sandbox --url
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp`; no bearer environment variable
is used. The real adapter rejects it before spawning with
`direct_mcp_external_gate_required`. A single earlier isolated attempt caused
dynamic registration and stopped with stable `invalid_client_metadata`; it used
no credentials, token, real profile, tool, or MCP call. B3 covers only the
isolated local lifecycle; B8 owns the external connection, authentication,
action, tool discovery, and first safe read.

## Local checks and review

- Focused `node --import tsx --test tests/chatgptPluginSmoke.test.ts
  tests/chatgptLifecycle.test.ts tests/pluginSmoke.test.ts` passed: 21/21.
- `npm run accept:chatgpt-lifecycle` passed all 11 matrix cases and printed the
  exact isolated-plugin and planned-B8 fallback labels.
- `WRANGLER_SEND_METRICS=false npm run check` passed: 126/126.
- `npm run benchmark:server` passed: p95 `3.505ms` (limit `20ms`).
- `npm run pack:chatgpt-plugin`, `npm run pack:chatgpt-lifecycle`, and
  `npm run pack:claude-delivery` passed.
- `npm pack --dry-run --json` passed for `0.3.4` with 22 files. The offline
  audit reported 0 findings and is explicitly cache-backed/non-fresh.
- `git diff --check` passed. Workflow-tester final PASS and original Sol final
  PASS followed remediation.

The refreshed B3 acceptance also stages a synthetic, non-published `0.3.3`
fixture, proves disabled `0.3.3` to `0.3.4` update, records deterministic
generated-profile transaction results in `dist/chatgpt-lifecycle/results.json`,
and continues to defer every real ChatGPT/Access/DCR operation to B8. No real
profile, MCP registration, OAuth, Access, tool discovery, CRM action, or tool
call occurred; the earlier DCR stop remains recorded above.
