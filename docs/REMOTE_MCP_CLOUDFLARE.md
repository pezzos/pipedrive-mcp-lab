# Remote MCP On Cloudflare

This is the operator guide for the multi-tenant remote Pipedrive MCP. It is
the recommended delivery for Claude Web/Desktop Chat and paid Cowork surfaces,
and for users who should not maintain a local process. Cowork Web and Mobile are
currently rolling out in beta; validate availability on the target account.
The existing Desktop Extension remains supported for local Claude Desktop use.

> **Deployment status:** commit `c7398c9` is deployed on the sandbox Worker as
> version `d0b493c2-7cbe-411d-af29-e7d08562c28a`. The v2 Durable Object
> bindings are active, the legacy singleton was retained without purge, and
> `/healthz`, the admin UI, the user route, and pre-OAuth MCP discovery were
> smoke-tested. Real two-user/two-company OAuth acceptance, live suspension
> checks, client rollout, and production promotion remain gated.

## User Experience

Before onboarding, an operator adds the user's exact email or IdP group to the
Access application's Allow policy. An allowed user then connects the remote MCP
URL in Claude and completes the Cloudflare Access login once. Access then refreshes the client authorization
and re-evaluates the Access policy without a routine user action. The user can
open `/pipedrive` to connect their own approved Pipedrive company, then open
`/settings` to manage only the permissions for that verified user-company pair.

This is deliberately not promised as a permanent login. A user must reconnect
when the configured Cloudflare Access grant expires or is revoked. A user must
reconnect their own Pipedrive grant when it is revoked, purged after 90 inactive
days, or refresh returns `invalid_grant`.

Pipedrive authorization is per Access user. Access and refresh tokens are
encrypted inside that user's `USER_CONNECTION` Durable Object; they are never
sent to Claude, shared with another user, or shown to the platform admin. The
named admin uses `/admin/pipedrive` only to approve, suspend, or resume company
subdomains and to force-disconnect a selected indexed connection. The page may
show Access email and bounded operational metadata, but never Pipedrive user
identity or token material.

## Architecture And Trust Boundaries

- Cloudflare Access Managed OAuth handles MCP client authorization at the
  edge. The Worker accepts only a valid signed `Cf-Access-Jwt-Assertion` for
  the configured issuer and audience.
- `/mcp` uses stateless Streamable HTTP. Every HTTP request gets a fresh MCP
  server and transport; no MCP session Durable Object is required.
- `TENANT_REGISTRY` is one global, token-free, strongly consistent Durable
  Object. It stores the domain allowlist, active/suspended status, pinned
  `company_id`, safe company name, opaque tenant correlation, and a bounded
  non-authoritative admin projection.
- `USER_CONNECTION` uses a collision-safe length-prefixed key derived from the
  verified Access `sub`. It stores exactly one logical active connection per
  user, encrypted tokens, OAuth/action state, generation, last successful MCP
  use, and the per-object 90-day cleanup alarm.
- `USER_POLICY` uses a collision-safe composite key for `(Access sub,
  company_id)`. There is no sub-only policy fallback.
- OAuth state binds Access subject, expected normalized domain, exact redirect,
  connection generation, operation nonce, and expiry. The callback verifies
  `api_domain`, calls `/api/v1/users/me` with the initiating user's new token,
  and pins or matches the stable company ID before promotion.
- `/admin/pipedrive` and every user/admin mutation require exact-origin POST,
  explicit confirmation where authority changes, and a one-shot token bound to
  actor, action, target, generation, and expiry.
- The model can call only the tools registered by the user's effective policy.
  It cannot change `/settings` or another user's policy.
- Audit events contain operational metadata only: pseudonymous actor, route,
  operation, effect, outcome, status, latency, bounded target identifiers, and
  policy revision, and opaque tenant correlation. CRM payloads, email addresses,
  JWTs, OAuth tokens, and
  Pipedrive response bodies must not be logged.

## Implemented Tenancy Boundary And Deployment Gate

`PRODUCT.md` records the single-tenant baseline that existed at the 2026-07-16
decision point and the approved multi-tenant contract. This guide records the
implemented operating boundary. The sandbox deployment was subsequently
verified at commit `c7398c9`; that evidence does not promote the Pipedrive app,
complete real multi-user OAuth acceptance, or authorize production rollout.

The repository implementation has this boundary:

| Surface | Current scope |
| --- | --- |
| Access identity | One authenticated `sub` per user. |
| Access application | One global `ACCESS_ISSUER` and `ACCESS_AUD` configuration for the Worker. |
| Tool policy | One `USER_POLICY` Durable Object per `(Access sub, company_id)`; every new pair is read-only. |
| Pipedrive connection | One encrypted `USER_CONNECTION` object per verified Access `sub`; no shared credential. |
| Tenant admission | One global, token-free `TENANT_REGISTRY`; user domains are verified and pinned to stable Pipedrive `company_id`. |
| Administration | One global `REMOTE_ADMIN_EMAIL` controls allowlist state and selected force-disconnect only. |
| MCP execution | The verified Access subject selects only its own connection; active admission is checked before and after provider paths. |

Local automated evidence covers cross-user keys, cross-company policies,
unknown/suspended non-enumeration with one shared lookup and deterministic
bounded-latency normalization, company pin/mismatch, failed replacement,
callback/refresh/disconnect races, user/admin disconnect, 90-day purge,
token-free admin projection, Worker bindings, and workerd Durable Object
routing. The timing test proves the local code path, not production network
timing or deployed concurrency.

Reproduce the focused local evidence with:

```sh
node --import tsx --test tests/tenantRegistry.test.ts tests/userConnection.test.ts tests/remoteWorker.test.ts tests/pipedriveAdminPage.test.ts tests/workerdDurableObjects.test.ts
npm run check
npm run benchmark:server
```

The sandbox code-deployment step is complete for `c7398c9`. The active version
preserves the four OAuth/audit secrets, uses `TENANT_REGISTRY`,
`USER_CONNECTION`, and `USER_POLICY`, and keeps the legacy singleton without
copying or purging it. The remaining acceptance gate must still run real OAuth
for at least two sandbox users/companies, verify suspension during deployed
provider calls, and decide the legacy singleton cleanup. Client rollout,
Pipedrive app promotion, and production promotion remain separately
authorized actions. The v1 `TenantSecrets` class stays exported only for
migration compatibility; v2 has no `TENANT_SECRETS` binding, request route,
credential read, or sub-only policy fallback.

## Permission Model

Every new `(Access sub, company_id)` pair starts read-only. After connecting at
`/pipedrive`, the user can enable or
disable these independent switches:

| Switch | Effect |
| --- | --- |
| Writes | Exposes ordinary create and update tools. Real execution still requires `dry_run=false`. |
| Deletes | Exposes delete tools only when Writes is also enabled. |
| Mailbox | Exposes Mailbox read tools. Linking a mail thread also requires Writes. |

Every write and delete tool defaults to `dry_run=true`. Increasing authority
requires an explicit confirmation in the settings form. Disabling a capability
is immediate and does not require confirmation.

## Required Cloudflare Configuration

The checked-in `wrangler.jsonc` declares `USER_POLICY`, `USER_CONNECTION`, and
`TENANT_REGISTRY`, with the original v1 migration retained and an additive v2
migration for the two new classes. Configure these values without committing
their contents:

| Name | Storage | Purpose |
| --- | --- | --- |
| `ACCESS_ISSUER` | Worker variable | Access issuer URL, including the team domain. |
| `ACCESS_AUD` | Worker variable | Audience tag of the Access application protecting this Worker. |
| `REMOTE_ADMIN_EMAIL` | Worker variable | Normalized Access email allowed to administer the global domain allowlist and selected force-disconnects. |
| `PIPEDRIVE_OAUTH_CLIENT_ID` | Secret | Pipedrive OAuth application client ID. |
| `PIPEDRIVE_OAUTH_CLIENT_SECRET` | Secret | Pipedrive OAuth application client secret. |
| `PIPEDRIVE_OAUTH_ENCRYPTION_KEY` | Secret | Random 32-byte base64url key used for AES-256-GCM token encryption. |
| `AUDIT_HMAC_KEY` | Secret | Independent random base64url key of at least 32 bytes for actor pseudonyms. |

Keep the encryption and audit keys independent. Rotation of the encryption key
requires reconnecting Pipedrive because existing OAuth material can no longer
be decrypted. Rotating the audit key deliberately breaks actor correlation
with older audit events.

## Sandbox Setup

1. Validate and deploy the Worker once to create the Cloudflare resource:

   ```sh
   npm ci
   npm run check
   npm run benchmark:server
   npx wrangler deploy
   ```

2. Attach a dedicated Custom Domain such as
   `pipedrive-mcp-sandbox.example.com`: open **Workers & Pages**, select
   `pipedrive-mcp-remote`, then **Settings > Domains & Routes > Add > Custom
   Domain**. The parent domain must be an active zone in the same account.
3. In Zero Trust, open **Access controls > Applications > Create new
   application**, select **Self-hosted and private**, and add the complete
   Worker hostname as a public hostname with no path restriction. Add an Allow
   policy for the intended users and save. Cloudflare documentation sometimes
   calls this an MCP server application; the dashboard creation tile is the
   self-hosted application type for a customer-managed Worker.
4. Edit that Access application, open **Advanced settings**, and enable
   **Managed OAuth**. Add only the redirect URIs required by the target Claude
   clients. A practical starting point is a 5–15 minute Access token and a 1–2
   week grant; select the exact values to match the client's security policy.
5. Create a Pipedrive Developer Sandbox and an OAuth application with only the
   scopes required by the tools being tested. Register
   `https://<worker-host>/oauth/pipedrive/callback` as its callback.
6. Copy the Access Application Audience and set the Worker variables and
   secrets listed above, then deploy again. SQLite-backed Durable Objects are
   available on Cloudflare Workers Free and Paid plans; review the applicable
   quotas and costs before production.
7. Sign in through Access as `REMOTE_ADMIN_EMAIL`, visit
   `https://<worker-host>/admin/pipedrive`, and approve only the intended
   Pipedrive subdomain. Approval does not grant Access membership or create an
   OAuth connection.
8. Give users the remote MCP URL `https://<worker-host>/mcp`. Each allowed user
   visits `https://<worker-host>/pipedrive`, enters the approved subdomain,
   completes their own one-shot OAuth flow, verifies the displayed company,
   then reviews the pair's read-only default at `/settings`.

Deployment, secret creation, Access changes, and Pipedrive authorization are
live actions. They are intentionally operator-run and are not part of ordinary
local repository validation.

## Sandbox Acceptance

Before production promotion, exercise the following with non-production data:

1. `/healthz` returns `200` with `transport: "streamable-http"`, then
   `pipedrive_connection_check` confirms a live read-only Pipedrive request.
2. An unauthenticated `/mcp` request is rejected and produces a redacted audit
   event.
3. Before the user's connection, `/mcp` fails fast with
   `pipedrive_not_connected`; after connection, that user sees read tools only
   and can complete a read-only Pipedrive call.
4. Enabling Writes requires confirmation. After enabling it, a write with
   default arguments remains a dry run.
5. Passing `dry_run=false` then permits an ordinary write.
6. Delete and Mailbox remain unavailable until their own switches are enabled.
7. Mailbox reads work with Mailbox alone; mail linking requires Mailbox and
   Writes.
8. Disabling a switch removes the corresponding authority on the next request.
9. Two Access users connected to different approved sandbox companies can read
   concurrently without cross-user, cross-company, callback, policy, refresh,
   or disconnect leakage.
10. A forced per-user token refresh is coalesced. Suspension during OAuth,
    refresh, or MCP fails closed before and after provider paths; resume
    restores retained connections without sharing credentials.
11. `/admin/pipedrive` shows approved domains, pinned safe company metadata,
    connected-user counts, and bounded Access-email rows, with no Pipedrive
    user identity or token material.
12. User self-disconnect and admin force-disconnect require confirmation, emit
    redacted audit events, affect exactly one selected connection, and make that
    user's next MCP request fail with `pipedrive_not_connected`.
13. At 90 days without successful MCP use, the per-user alarm purges encrypted
    tokens and returns `pipedrive_reconnect_required`; approval and the
    `(sub, company_id)` policy remain intact. Verify cleanup within the
    documented 24-hour operational window.

## Worker Rollback

Before every sandbox deployment, record the currently active version with
`npx wrangler deployments list`. If the new Worker regresses, run
`npx wrangler rollback <version-id>` with that captured healthy version, then
repeat `/healthz`, the anonymous `/mcp` rejection, the protected admin page,
and two-user isolation checks. A Worker rollback does not restore deleted OAuth tokens and must not
change Access, rotate secrets, or uninstall the Pipedrive application.

## Production Promotion

Promote the same verified commit and Worker artifact. Replace the sandbox
Pipedrive OAuth application values with the production application values,
review Access membership and durations, then repeat allowlist approval,
per-user connections, and acceptance smoke tests against deliberately selected
production records.

A private Pipedrive application in `DRAFT` can be tested only in its developer
sandbox. Changing it to live is a separate manual and irreversible promotion;
it is never implied by deploying this Worker and requires explicit operator
authorization.

Production is blocked until console audit events are exported to a durable
Logpush or SIEM destination with agreed retention, access control, alerting,
and cost ownership. The Worker currently emits structured redacted JSON to the
console; console output alone is not a production retention strategy.

## Incident Guide

OAuth administration error pages expose only a stable error code and a Worker
request ID. Use both to correlate the structured audit event; raw provider
responses, authorization codes, state values, and exception messages are
intentionally omitted.

| Symptom or code | Action |
| --- | --- |
| `/healthz` fails | Check Worker deployment and Cloudflare status before investigating Pipedrive. |
| `mcp_registration_failed` | Confirm Managed OAuth and the Claude callback allowlist, then recreate the connector after configuration changes. |
| `access_denied` or `access_configuration_invalid` | Verify Worker variables, Access policy, issuer, and audience. |
| `access_token_missing` or `access_token_invalid` | Reconnect the Claude connector and verify that the user remains allowed by Access. |
| `access_jwks_unavailable` or `access_jwks_invalid` | Check Access availability and the issuer certificate endpoint; do not bypass JWT validation. |
| `policy_unavailable` | Check the `USER_POLICY` Durable Object binding and recent Worker errors. Do not bypass the policy. |
| `pipedrive_not_connected` | The affected user opens `/pipedrive` and starts a fresh connection to an approved domain. |
| `admin_required` | Sign in through Access as the exact `REMOTE_ADMIN_EMAIL`; do not broaden Access policy as a workaround. |
| `admin_origin_invalid` or `admin_method_not_allowed` | Reload `/admin/pipedrive` on the Worker origin and submit its form normally. Do not replay a cross-origin request. |
| `admin_confirmation_required` | Read and select the explicit tenant or selected-connection confirmation before submitting again. |
| `tenant_admin_action_invalid` | The one-shot token expired, was used, or no longer matches actor, action, target, or generation. Reload `/admin/pipedrive`; do not replay the form. |
| `user_action_invalid` | Reload `/pipedrive`; the user's one-shot connect/disconnect token expired, was used, or targets an older generation. |
| `tenant_admission_denied` | The domain is unknown, unapproved, suspended, or intentionally indistinguishable at the user boundary. Contact the platform admin; do not probe alternate hosts. |
| `pipedrive_reconnect_required` | The affected user reconnects at `/pipedrive`; investigate revocation, 90-day purge, or OAuth app changes. |
| `oauth_authorization_denied` | The user denied Pipedrive consent. Start a fresh connection only if authorization is still intended. |
| `oauth_state_invalid` or `oauth_code_invalid` | The callback expired, was already used, or does not match its initiator. Start again at `/pipedrive`; never replay the callback URL. |
| `oauth_redirect_invalid` | Verify the Worker custom domain and that the exact callback URL is registered in the Pipedrive application. |
| `oauth_encryption_key_invalid` | Verify that `PIPEDRIVE_OAUTH_ENCRYPTION_KEY` decodes to exactly 32 bytes. Correct the secret before starting a fresh connection. Replacing a previously valid key makes stored OAuth material unreadable and therefore requires reconnection. |
| `oauth_encryption_failed` | Treat as a Worker crypto/runtime failure. Correlate the request ID and retry after checking Worker status; do not rotate a valid key speculatively. |
| `oauth_material_invalid` | After encryption-key rotation or corrupted storage, reconnect Pipedrive to replace the unreadable material. |
| `pipedrive_oauth_unavailable` | Check Pipedrive OAuth and network availability, then retry from a fresh connection. |
| `pipedrive_oauth_invocation_failed` | The Worker runtime rejected the outbound OAuth call because its function receiver was invalid. Deploy the receiver-safe implementation before starting a fresh connection; rotating credentials does not correct this code defect. |
| `pipedrive_oauth_invalid_response` or `invalid_pipedrive_api_domain` | Verify the Pipedrive OAuth application, environment, callback, and provider response contract. Do not persist or trust an unexpected API domain. |
| `pipedrive_oauth_failed` or `pipedrive_credential_unavailable` | Check the Pipedrive application credentials, callback, scopes, and Worker audit event, then reconnect only if the grant is no longer usable. |
| `tenant_request_invalid` | The Worker-to-Durable-Object request was malformed. Treat this as a deployment/version mismatch and redeploy one coherent artifact. |
| `tenant_storage_unavailable` | Check Durable Object health, bindings, and Cloudflare status; retry without changing OAuth secrets. |
| `tenant_internal_error` | Correlate the request ID with Worker logs and inspect the deployment. This deliberately hides an unclassified internal failure; do not rotate secrets based on this code alone. |
| Repeated Pipedrive 401/403 | Confirm OAuth scopes and production/sandbox app alignment before reconnecting. |

Do not log or paste Access assertions, OAuth codes, refresh tokens, encryption
keys, or CRM response bodies into incident tickets. Correlate by the Worker
request ID and pseudonymous actor ID.

Self-disconnect at `/pipedrive` or selected force-disconnect at
`/admin/pipedrive` deletes only that user's OAuth tokens stored by the Worker.
It stops future calls for that connection but does not revoke the provider
grant. Until Pipedrive exposes a suitable revocation API for this flow,
provider-side revocation requires manually uninstalling the application.

## Primary References

- [Anthropic remote MCP connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [Cloudflare remote MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [Cloudflare Access Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [Cloudflare Durable Objects pricing and limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Pipedrive OAuth](https://developers.pipedrive.com/docs/api/v1/Oauth)
- [Pipedrive Developer Sandbox](https://pipedrive.readme.io/docs/developer-sandbox-account)

These platform references were checked on 2026-07-16.
