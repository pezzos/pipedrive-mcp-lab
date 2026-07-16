# Remote MCP On Cloudflare

This is the operator guide for the single-tenant remote Pipedrive MCP. It is
the recommended delivery for Claude Cowork, web, mobile, and users who should
not maintain a local process. The existing Desktop Extension remains supported
for local Claude Desktop use.

## User Experience

An allowed user connects the remote MCP URL in Claude and completes the
Cloudflare Access login once. Access then refreshes the client authorization
and re-evaluates the Access policy without a routine user action. The user can
open `/settings` to manage only their own permissions.

This is deliberately not promised as a permanent login. A user must reconnect
when the configured Cloudflare Access grant expires or is revoked. An admin
must reconnect Pipedrive when its OAuth grant is revoked or refresh returns
`invalid_grant`.

The Pipedrive authorization is tenant-wide and completed once by the named
admin. Pipedrive access and refresh tokens are encrypted in a singleton Durable
Object; they are never sent to Claude or stored in a user's browser.

## Architecture And Trust Boundaries

- Cloudflare Access Managed OAuth handles MCP client authorization at the
  edge. The Worker accepts only a valid signed `Cf-Access-Jwt-Assertion` for
  the configured issuer and audience.
- `/mcp` uses stateless Streamable HTTP. Every HTTP request gets a fresh MCP
  server and transport; no MCP session Durable Object is required.
- `USER_POLICY` stores one independent policy per Access subject.
- `TENANT_SECRETS` persists the shared encrypted Pipedrive OAuth material and
  one-shot authorization state. Concurrent refreshes are coalesced in memory
  while the Durable Object instance is active.
- The model can call only the tools registered by the user's effective policy.
  It cannot change `/settings` or another user's policy.
- Audit events contain operational metadata only: pseudonymous actor, route,
  operation, effect, outcome, status, latency, bounded target identifiers, and
  policy revision. CRM payloads, email addresses, JWTs, OAuth tokens, and
  Pipedrive response bodies must not be logged.

## Permission Model

Every new Access user starts read-only. At `/settings`, the user can enable or
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

The checked-in `wrangler.jsonc` declares the Worker and both Durable Object
bindings. Configure these values without committing their contents:

| Name | Storage | Purpose |
| --- | --- | --- |
| `ACCESS_ISSUER` | Worker variable | Access issuer URL, including the team domain. |
| `ACCESS_AUD` | Worker variable | Audience tag of the Access application protecting this Worker. |
| `REMOTE_ADMIN_EMAIL` | Worker variable | Normalized Access email allowed to start and complete Pipedrive OAuth. |
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
7. Sign in through Access as `REMOTE_ADMIN_EMAIL`, then visit
   `https://<worker-host>/admin/pipedrive/connect`. Complete Pipedrive consent
   once. If a callback fails, start a fresh connection from this URL; OAuth
   state and authorization codes are one-shot and must not be replayed.
8. Give users the remote MCP URL `https://<worker-host>/mcp`. Each user signs
   in through Access and can review their own policy at
   `https://<worker-host>/settings`.

Deployment, secret creation, Access changes, and Pipedrive authorization are
live actions. They are intentionally operator-run and are not part of ordinary
local repository validation.

## Sandbox Acceptance

Before production promotion, exercise the following with non-production data:

1. `/healthz` returns `200` with `transport: "streamable-http"`.
2. An unauthenticated `/mcp` request is rejected and produces a redacted audit
   event.
3. Before the admin connection, `/mcp` fails fast with
   `pipedrive_not_connected`; after connection, a new user sees read tools only
   and can complete a read-only Pipedrive call.
4. Enabling Writes requires confirmation. After enabling it, a write with
   default arguments remains a dry run.
5. Passing `dry_run=false` then permits an ordinary write.
6. Delete and Mailbox remain unavailable until their own switches are enabled.
7. Mailbox reads work with Mailbox alone; mail linking requires Mailbox and
   Writes.
8. Disabling a switch removes the corresponding authority on the next request.
9. Disconnecting and reconnecting the Claude connector succeeds without an
   admin Pipedrive reconnect.
10. A forced Pipedrive token refresh is coalesced, and a revoked grant produces
    `pipedrive_reconnect_required` without exposing token material.

## Production Promotion

Promote the same verified commit and Worker artifact. Replace the sandbox
Pipedrive OAuth application values with the production application values,
review Access membership and durations, then repeat the admin connection and
acceptance smoke tests against deliberately selected production records.

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
| `access_denied` or `access_configuration_invalid` | Verify Worker variables, Access policy, issuer, and audience. |
| `access_token_missing` or `access_token_invalid` | Reconnect the Claude connector and verify that the user remains allowed by Access. |
| `access_jwks_unavailable` or `access_jwks_invalid` | Check Access availability and the issuer certificate endpoint; do not bypass JWT validation. |
| `policy_unavailable` | Check the `USER_POLICY` Durable Object binding and recent Worker errors. Do not bypass the policy. |
| `pipedrive_not_connected` | The admin completes `/admin/pipedrive/connect`. |
| `pipedrive_reconnect_required` | The admin reconnects Pipedrive; investigate revocation or OAuth app changes. |
| `oauth_authorization_denied` | The admin denied Pipedrive consent. Start a fresh connection only if authorization is still intended. |
| `oauth_state_invalid` or `oauth_code_invalid` | The callback expired, was already used, or does not match its initiator. Start again at `/admin/pipedrive/connect`; never replay the callback URL. |
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

## Primary References

- [Anthropic remote MCP connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [Cloudflare remote MCP server guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [Cloudflare MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [Cloudflare Access Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [Cloudflare Durable Objects pricing and limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Pipedrive OAuth](https://developers.pipedrive.com/docs/api/v1/Oauth)
- [Pipedrive Developer Sandbox](https://pipedrive.readme.io/docs/developer-sandbox-account)

These platform references were checked on 2026-07-15.
