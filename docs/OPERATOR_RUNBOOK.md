# Operator Runbook

This runbook covers local and named-private-pilot operation of `pipedrive-mcp`.
For the Cloudflare Worker, Access, and Pipedrive OAuth procedure, use the
[remote MCP runbook](REMOTE_MCP_CLOUDFLARE.md).

## B0 private-pilot operating constraints

The pilot is Pezzos Labs plus one authorized customer, not a public service.
Its first-class customer surfaces are the unified ChatGPT desktop app (with
Codex) and ChatGPT Web; Codex CLI/IDE are technical/operator fallbacks.
Existing Claude delivery is compatibility-only and does not establish a new
customer surface or acceptance promise.

Alexandre is the sole temporary production administrator and owner of support,
incident command, and offboarding. Davy Guittard of Keilintech is designated-not-activated: not informed, not accepted, with no access or validated recovery. B9/B10 and any production, billing, or expansion work require notification, acceptance, least-privilege access provisioning, and recovery validation.

The sole pre-D08 exception is B7/B8 work in the separate named sandbox after a recorded unpaid informed-testing receipt, safe expected records, Alexandre-only reads/alerts, and exact authority. Billing, additional-customer access, real production data or traffic, public availability, or security incident stops it; a security incident needs closure and fresh authority. B9/B10, production, billing, and expansion remain completed-D08 gated.

Production audit is specified as Cloudflare Logpush to a dedicated production
R2 bucket with 90-day retention, pipeline-only writes, controlled
immutability/versioning, automatic expiry deletion, and a documented legal
hold. While D08 is designated-not-activated, audit reads are Alexandre-only. Critical alerts
email Alexandre only, with no 24/7 promise; a security or tenancy alert freezes
rollout until acknowledged. The observability allocation is at most EUR 10
excluding tax/month, and the global infrastructure-plus-observability cap is
EUR 25 excluding tax/month (excluding existing ChatGPT/Pipedrive
subscriptions). These are future live gates, not completed configuration.

The pilot is limited to two companies, four named users, and 1,000 tool
calls/day. Freeze onboarding at 80% of a limit; do not increase a plan or quota
automatically. The service is best effort, with a one-business-day recovery
target, 24-hour RPO for configuration/audit, and no contractual SLA.

See [`decisions/0001-production-delivery-contract.md`](decisions/0001-production-delivery-contract.md)
and [`decisions/B0-production-decisions.json`](decisions/B0-production-decisions.json)
for the full decision record.

## Install And Build

```sh
npm install
npm run check
npm run build
```

Use `node dist/server.js` as the MCP command.

For the existing Claude compatibility delivery only:

```sh
npm run pack:claude-delivery
```

This program does not invoke the Claude CLI. Any compatibility-specific Claude
CLI validation is optional, outside B0--B14 acceptance, and cannot be a gate
for this production program.

Standalone ZIPs are staged at `dist/claude-skills/`. The plugin artifact is
staged at `dist/claude-plugin/pipedrive-mcp/`.

## Environment Contract

Required for live API calls:

- `PIPEDRIVE_COMPANY_DOMAIN` or `PIPEDRIVE_BASE_URL`
- `PIPEDRIVE_API_TOKEN` or `PIPEDRIVE_ACCESS_TOKEN`

Operational flags:

- `PIPEDRIVE_ENABLE_WRITES=false` by default. Set to `true` to register CRM
  write tools.
- `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=false` by default. Set to `true` together
  with writes to register Mailbox tools.
- `PIPEDRIVE_ENABLE_DELETE_TOOLS=false` by default. Set to `true` together with
  writes to register delete tools.
- `PIPEDRIVE_LOAD_DOTENV=true` by default. Set to `false` when the MCP host
  supplies all environment variables.
- `PIPEDRIVE_REQUEST_TIMEOUT_MS=10000` by default.
- `PIPEDRIVE_ALLOW_MOCK_BASE_URL=false` by default. Use `true` only for loopback
  mocked tests.

Only the local `.env` next to the package is loaded. Parent `.env` files are
ignored. An unreadable optional `.env` no longer prevents MCP startup;
`pipedrive_health_check` reports `dotenv_load_failed=true` for diagnosis.

## Write Operation

CRM write tools are hidden unless `PIPEDRIVE_ENABLE_WRITES=true`.

Every write tool defaults to `dry_run=true`. To execute a real write, the caller
must pass `dry_run=false` and the server must have writes enabled. No per-call
confirmation string is required in this production contract.

Use `validate_links=true` when a write references existing Pipedrive record IDs.
The server will read those linked records before sending the write.

## Delete Operation

Delete tools are hidden unless both flags are enabled:

```sh
PIPEDRIVE_ENABLE_WRITES=true
PIPEDRIVE_ENABLE_DELETE_TOOLS=true
```

Delete calls still default to `dry_run=true`.

## Mailbox

Mailbox read tools are hidden unless the Mailbox flag is enabled. Linking a
thread additionally requires writes because it changes Pipedrive:

```sh
PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true
```

Add `PIPEDRIVE_ENABLE_WRITES=true` only when mail linking is required.

Some accounts may require OAuth scopes for Mailbox. The local server accepts an
externally supplied `PIPEDRIVE_ACCESS_TOKEN`; the remote Worker obtains and
refreshes the current user's encrypted OAuth grant.

Mailbox draft creation, sending, and replies are not supported by this MCP
version. To create an email to-do, use `pipedrive_create_activity` with
`type="email"` and place the draft body or instructions in `note`.

## Remote Pipedrive Connection Administration

> **Deployment gate:** commit `c7398c9` is deployed on the sandbox Worker as
> version `d0b493c2-7cbe-411d-af29-e7d08562c28a`. Health, administration, user
> routing, and pre-OAuth MCP discovery are verified. Do not treat this sandbox
> smoke test as real two-user OAuth acceptance, client rollout, Pipedrive app
> promotion, or production readiness; complete the remaining canonical
> [deployment gate](REMOTE_MCP_CLOUDFLARE.md#implemented-tenancy-boundary-and-deployment-gate).

Sign in through Cloudflare Access as `REMOTE_ADMIN_EMAIL` and open
`https://<worker-host>/admin/pipedrive`. This page controls global admission,
not a shared OAuth grant:

1. Approve a normalized Pipedrive subdomain. The confirmation is exact-origin,
   explicit, and one-shot. Approval does not add anyone to Access.
2. After the first user's verified OAuth callback, confirm the pinned safe
   company name and stable company ID. A later mismatch is rejected.
3. Suspend a domain to fail closed for new OAuth, callbacks, refresh, and MCP.
   Resume only after the incident or policy reason is resolved; retained
   per-user grants can resume without token sharing.
4. Use a connection row's confirmation page to force-disconnect exactly that
   user. The admin projection may show Access email and bounded timestamps but
   must never show Pipedrive user identity or token material.
5. Confirm audit events contain only operational metadata: pseudonymous actor,
   opaque tenant ID, request ID, timestamp, route, operation, effect, outcome,
   status, latency, and stable error code. They must contain no JWT, token,
   email, company/user identity, or CRM payload.

Each allowed user manages their own connection at `/pipedrive`: enter an
approved subdomain, complete OAuth, verify the company, replace the connection
only through a fresh one-shot state, and self-disconnect with explicit
confirmation. `/settings` then manages only `(Access sub, company_id)` and
starts read-only for every new pair.

Self-disconnect and admin force-disconnect remove only the selected user's
encrypted local tokens. They do not uninstall the Pipedrive application or
revoke its provider grant. Provider-side revocation remains a separate manual,
destructive action.

## ChatGPT removal ladder

Treat these as four separate layers, in order: (1) uninstall the private
ChatGPT plugin/app from the client profile; (2) use `/pipedrive` self-disconnect
or the selected admin force-disconnect to remove that user's Worker-held grant;
(3) remove the user or group from the Cloudflare Access Allow policy; (4) revoke
or uninstall the provider-side Pipedrive grant manually. No layer implies that
the next was performed. B3 validates only local isolated plugin cleanup; the
real ChatGPT/Access/provider layers remain B8 gates.

### Moving from sandbox to the intended company

Before attempting the connection, verify that the OAuth application can be
installed in the target company. A private Pipedrive application in `DRAFT` is
limited to its developer sandbox. Changing it to live is manual, irreversible,
and requires explicit authorization; a Worker deployment never performs or
authorizes that promotion.

The approved V1 acceptance requires two users connected to two different
companies. If the application cannot be installed in a second non-production
company, stop the live acceptance; two users in the same developer sandbox are
not a substitute.

When the application is installable in the target company, the platform admin
approves its subdomain, then each intended user connects from `/pipedrive` and
verifies the returned company before running `pipedrive_connection_check` and
a known read. Do not infer the account from an OAuth success screen alone.

### Worker rollback

Before a separately authorized Worker change, validate its local target and
write a dry-run provenance record. This has no Cloudflare effect:

```sh
npm run validate:worker-topology
npm run prepare:worker-release -- --target sandbox
npm run verify:worker-release -- --target sandbox
```

Preparation refuses a dirty source tree. The workflow-dispatch-only GitHub
workflow targets the protected `pipedrive-sandbox` or
`pipedrive-production` environment, serializes each target, checks the exact
checked-out SHA is clean, creates and revalidates the record, then deploys only
that target config. It never runs automatically. The protected environment must
provide the three Worker variables, four Worker secrets,
`CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_API_TOKEN`; the deploy script uses a
temporary mode-`0600` JSON secrets file and removes it afterward. Preparation
needs no live Access variables. Production
preparation must stop when real production client metadata is missing, rather
than reusing the sandbox client.

Before deploying a Worker update, capture `npx wrangler deployments list`. If
smoke tests regress, run `npx wrangler rollback <version-id>` with the captured
healthy version and repeat `/healthz`, anonymous `/mcp`, Access protection, the
admin page, and two-user isolation. The rollback target must already be
compatible with the v2 `TENANT_REGISTRY`, `USER_CONNECTION`, and `USER_POLICY`
topology; never restore a singleton credential path. A Worker rollback does not
reverse Durable Object migrations or restore locally deleted OAuth tokens and
must not change Access, rotate secrets, or uninstall the Pipedrive application.

## Private Package Delivery

The package is private and is not prepared for public npm publication. Use:

```sh
npm pack --dry-run
npm pack
```

The tarball should contain runtime files, README, LICENSE, config example, and
docs only. It must not include source, tests, historical validation notes, or
validation prompts.

## Claude Compatibility Delivery (not a first-class pilot surface)

Before onboarding or handing out the hardcoded sandbox connector, verify that
the active Worker is still version
`d0b493c2-7cbe-411d-af29-e7d08562c28a` (or a later explicitly accepted
version) and complete the remaining separately authorized
[deployment gate](REMOTE_MCP_CLOUDFLARE.md#implemented-tenancy-boundary-and-deployment-gate).
The current sandbox smoke test does not prove real two-user OAuth, suspension,
or client-surface acceptance.

Use `npm run pack:claude-delivery` to stage the standalone skill ZIPs and the
plugin. Routine paid delivery should use a private plugin repository or private
Claude plugin marketplace. Use `claude --plugin-dir` only for local pilot
testing.

The paid plugin contains the seven skills and exactly one remote HTTP connector
in its root `.mcp.json`. Pro, Max, Team, and Enterprise users install that
plugin. Free users import selected ZIP assets from the latest GitHub Release and add the
same remote `/mcp` URL manually. Each archive must contain one top-level skill
folder with its `SKILL.md`, and no connector or credentials.

The first-class pilot acceptance surfaces are the unified ChatGPT desktop app
(with Codex) and ChatGPT Web. The B2/B3 implementation defines their private
installation and lifecycle evidence. Claude/Cowork instructions in this
section preserve compatibility only and cannot be used as B8/B9/B10 acceptance
evidence. Users still authenticate through Cloudflare Access, connect their own
approved Pipedrive identity at `/pipedrive`, and manage only that company pair
at `/settings`; the admin controls the global allowlist without receiving user
tokens.

Before handing off either installation path, add the user's exact email or IdP
group to the Cloudflare Access application's Allow policy. Record who owns this
onboarding step. Importing a skill or plugin does not grant Access membership.

The `.mcpb` remains a local Claude Desktop fallback where users configure
`company_domain`, API/OAuth token, write flags, and timeout. It is an alternative
to the remote connector, not an additional step. Never activate the `.mcpb`, a
legacy `claude_desktop_config.json` entry, and the remote connector at the same
time.

The source server, MCPB manifest, skills, and marketplace now live in this one
canonical repository. The existing `pipedrive-mcp-claude-plugin` repository is
kept as a generated compatibility distribution so installed client URLs do not
change.

Use the release script to publish the Desktop Extension and plugin repository.
It builds and validates the local package, syncs an archive-free distribution
repository, creates both a versioned `.mcpb` and `pipedrive-mcp-latest.mcpb`,
generates versioned and `latest` standalone skill ZIPs, uploads those archives
as GitHub Release assets, then verifies the published downloads after push.

For local preparation, no second checkout is required:

```sh
npm run prepare:claude-plugin-release
```

The marketplace snapshot is generated under
`dist/release/pipedrive-mcp-claude-plugin/`; it must contain no archives. GitHub
Release assets are staged separately under `dist/release/assets/`. An explicit
existing checkout is still supported through `--distribution-repo` or
`PIPEDRIVE_MCP_PLUGIN_REPO` for backward compatibility.

For an actual publication:

```sh
PIPEDRIVE_MCP_PLUGIN_GIT_URL=https://github.com/pezzos/pipedrive-mcp-claude-plugin.git \
  npm run release:claude-plugin
```

Publication clones the compatibility repository into a temporary directory,
generates and validates the distribution, refuses to overwrite a released
version with different content, commits only actual changes, pushes the selected
branch, publishes GitHub Release assets, and verifies their downloads. Use
`--distribution-git-branch <branch> --skip-release-assets --skip-remote-verify`
for a disposable staging installation test. Do not hand-edit the distribution
repository for ordinary releases.

## Upgrading From Lab Version

Remove these environment variables from host configs:

- `PIPEDRIVE_WRITE_CONFIRMATION`
- `PIPEDRIVE_REQUIRE_WRITE_CONFIRMATION`
- `PIPEDRIVE_ALLOW_LAB_WRITE_CONFIRMATION`
- `PIPEDRIVE_REQUIRE_LAB_PREFIX`
- `PIPEDRIVE_LAB_PREFIX`

Remove these fields from tool calls:

- `confirmation`
- `confirm_lab_write`

Use the new flags instead:

- `PIPEDRIVE_ENABLE_WRITES=true` to register CRM write tools.
- `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true` to register Mailbox tools.
- `PIPEDRIVE_ENABLE_DELETE_TOOLS=true` to register delete tools.

Parent directory `.env` files are no longer loaded. Move required variables into
the MCP package `.env` or the MCP host configuration.

## Validation

## B6 configuration and rotation

Before a B6-capable deployment, configure the required variable names
`REMOTE_ADMIN_SUB`, `PIPEDRIVE_OAUTH_CLIENT_EPOCH`,
`PIPEDRIVE_OAUTH_ENCRYPTION_KID`, and `AUDIT_HMAC_EPOCH`. Administration
requires both the normalized configured email and the exact Access subject.
Never set only one name of an optional rotation pair. Access cutover accepts a
complete previous issuer/audience pair only through its exact UTC cutoff; it
never mixes an issuer from one pair with an audience from another. Roll back a
Worker version only to one compatible with the current v2 Durable Object
topology; do not roll back secret rotation or delete connection material.

For planned annual encryption rotation, install the new primary kid/key with
the old pair decrypt-only. The protected admin receipt must show zero active
`old`, `legacy`, and `unknown` envelopes (an unknown row is not zero-use), then
wait 30 days after its latest non-primary decrypt/rewrap timestamp before
retiring the old pair. A compromise rotates the primary immediately and may
force reconnect; do not wait 30 days to stop using a compromised primary. Schedule
a new audit epoch each quarter, while allowing immediate same-quarter emergency
identifiers for compromise response; the prior audit rotation is always the
triple `AUDIT_HMAC_PREVIOUS_EPOCH` + `AUDIT_HMAC_PREVIOUS_KEY` +
`AUDIT_HMAC_PREVIOUS_VALID_UNTIL` UTC cutoff, and retains correlation for no more
than 90 days; the registry retains a fingerprint-only first-seen ledger (64
records) so removing and re-adding a prior key cannot extend that window.
Rotate the provider client secret together with a new OAuth
client epoch; old pending callbacks fail safely. Access cutover uses complete
issuer/audience pairs and a UTC cutoff. Before any live action, verify MFA and
that both configured admin email and subject are exact. Freeze onboarding at
80% capacity; never auto-increase quota. Stop on capacity, identity, or
rotation errors and use only a v2-compatible Worker rollback.

Required local validation:

```sh
npm run check
npm run benchmark:server
npm run pack:claude-delivery
npm run prepare:claude-plugin-release
npm pack --dry-run
```

The deterministic commands above are the local validation path for this
program. Claude CLI validation, if an operator later chooses to run it for
compatibility, is optional and outside this program's acceptance path.

Do not run live writes as part of ordinary validation. If live credentials are
already configured, limit manual checks to read-only tools unless an operator
explicitly approves a write test.

Platform behavior was checked on 2026-07-16 against Anthropic's
[local MCP server guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
[skills guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude),
[plugins guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude), and
[Cowork surface guide](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile).
The monorepo marketplace layout was checked separately against Anthropic's
[plugin marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).

## Server-rendered recovery pages

Use the normal same-origin pages for recovery. `/pipedrive` explains safe
connection, cancellation, mismatch, and local-token recovery states; `/settings`
keeps capability changes scoped to the verified connection; `/admin/pipedrive`
uses one-shot, generation-bound confirmations. Reload an expired confirmation
instead of replaying it. Local disconnect removes Worker-held OAuth material
only; it changes neither Access, the ChatGPT app, nor the provider grant.
# B7 audit preparation (historical, superseded in part)

Before the 2026-07-22 cutover receipt, audit source records were locally prepared only. That historical statement remains true for the earlier state, but is superseded for the limited sandbox facts now recorded below; do not represent console output as durable R2 evidence.

## B7 2026-07-22 sandbox cutover boundary

The hash-verified `ops/evidence/B7-live-cutover-2026-07-22.json` records a limited synthetic sandbox Logpush/R2 delivery, sampled byte integrity, one offline query, credential revocation, and authority-linked obsolete-job configuration removal. The authority scope is the redacted current-session `SW + DW` operator packet for old-token revocation and permanent obsolete-job deletion, explicitly excluding R2 object deletion; its source digest is not a chat hash. It does not authorize any further live action and does not prove production durability or routing, which is future scope outside B7. The final observed-object timestamp is separate from the credential-revocation fact; it must not be described as post-revocation delivery.

Treat the alert test as submission only: email receipt and acknowledgement are pending, and no sent/delivered result may be asserted. Davy Guittard of Keilintech remains designated-not-activated, not informed or accepted, without access or recovery validation. The alert recipient was observed Alexandre-only, while the active one-bucket Object Read & Write Logpush credential is a technical principal; absent a durable exhaustive reader/token inventory, strict Alexandre-only reading is unproven and belongs in the remaining non-backup live checks. Keep all five sandbox stop triggers in force; stop immediately on customer billing, additional-customer access, real production data or traffic, public availability, or a security incident. B7 remains `in_progress` pending alert receipt/acknowledgement, the exhaustive B7 sandbox validation packet, and remaining non-backup live checks. Production durability/routing is not a B7 blocker.

The preceding pending-alert statement is historical and superseded only for the alert state by `ops/evidence/B7-alert-email-ack-2026-07-22.json`. The append-only receipt records a hash-only, redacted operator-supplied appshot of the signed `notify.cloudflare.com` test notification and the operator acknowledgement at the appshot capture/share timestamp `2026-07-22T12:14:55.928Z`, after the receipt-minute interval; it retains no raw headers or message and creates no further live authority. Do not infer a second-order delivery time or an actual live job failure from the minute-precision receipt. The alert blocker is closed. B7 remains `in_progress` pending the exhaustive B7 sandbox validation packet and remaining non-backup live checks, including unproven `read_access_alexandre_only` and actual-live-job-failure notification.
