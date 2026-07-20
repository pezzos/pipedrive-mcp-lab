# Product Requirements: Multi-Tenant Pipedrive MCP

## Document Status

- **Status:** Approved and implemented on the sandbox Worker; client rollout
  and production promotion remain gated
- **Decision date:** 2026-07-16
- **Canonical scope:** Remote Cloudflare Worker tenancy, onboarding, OAuth,
  administration, user permissions, isolation, and migration
- **Current implementation baseline:** Multi-tenant per-user connections,
  tenant admission, isolated policies, administration, and migration-safe
  Durable Object routing integrated on `main` at `8dcb634`
- **Documentation status:** `docs/REMOTE_MCP_CLOUDFLARE.md` and the operator
  documentation describe the checked-in multi-tenant boundary; real client
  onboarding still requires two-user/two-company OAuth acceptance and deployed
  suspension checks, while client rollout and production promotion remain
  separate operational gates

## Product Summary

The remote Pipedrive MCP must become a multi-tenant service in which each
Cloudflare Access user connects their own Pipedrive identity and can reach only
the Pipedrive company selected during their OAuth flow.

A platform administrator approves Pipedrive company domains before onboarding.
An allowed Access user enters an approved domain, completes Pipedrive OAuth,
and receives one active encrypted connection bound to their Access subject.
Romain acts as Romain with Romain's Pipedrive permissions; Alexandre acts as
Alexandre with Alexandre's Pipedrive permissions. No tenant-wide or
administrator-owned Pipedrive token is shared between users.

The product remains read-only by default. Each user manages their own Writes,
Deletes, and Mailbox capabilities for the connected Pipedrive company.

## Private Pilot Delivery Contract

V1 is a named private pilot for Pezzos Labs and one authorized customer; it is
not publicly available. The first-class customer surfaces are the unified
ChatGPT desktop app (with Codex) and ChatGPT Web. Codex CLI/IDE are technical
or operator fallbacks, and existing Claude delivery is compatibility-only with
no new surface or acceptance promise.

The pilot uses one full private ChatGPT Pipedrive app containing all seven
canonical workflows, installed only for named pilot workspaces/users. Pipedrive
distribution is private or unlisted for the named pilot companies. These
delivery decisions, the production endpoint, operating gates, retention,
budgets, canary, and singleton-purge constraints are defined by
[`docs/decisions/0001-production-delivery-contract.md`](docs/decisions/0001-production-delivery-contract.md).
They do not assert that an external installation, publication, or production
resource already exists.

## Problem

The original Worker authenticated every Claude user independently through
Cloudflare Access but routed all of them through one singleton Pipedrive OAuth
grant stored in the `TENANT_SECRETS` Durable Object named `tenant`. That model
was safe for a single-company pilot but could not onboard a second client under
an assumption of data isolation.

The service needs two distinct controls:

1. **User admission:** Cloudflare Access decides who may reach the service.
2. **Pipedrive company admission:** the platform administrator decides which
   Pipedrive companies may be connected.

Pipedrive OAuth must then prove the user's membership and provide a credential
for that specific user and company. Passing Access alone must never grant a
Pipedrive credential, and approving a Pipedrive domain must never bypass
Cloudflare Access.

## Product Outcomes

The feature is successful when:

1. Two Access users can connect two different approved Pipedrive companies on
   the same Worker and every MCP call uses the caller's own token.
2. A user cannot read, mutate, replace, refresh, or disconnect another user's
   connection or policy.
3. The platform administrator can approve and suspend a Pipedrive company
   without handling users one by one.
4. A suspended company is blocked immediately for existing and new requests.
5. Failed, cancelled, stale, or cross-tenant OAuth flows cannot replace a valid
   connection or resurrect deleted credentials.
6. Named pilot users can install the same private ChatGPT Pipedrive app and
   complete onboarding without
   receiving secrets or requiring a dedicated Worker deployment.
7. Inactive OAuth tokens are removed after 90 days without successful MCP use.

## Personas

### Platform Administrator

The single operator identified by `REMOTE_ADMIN_EMAIL`. This person:

- approves, suspends, and resumes Pipedrive company domains;
- sees limited connection metadata needed for support;
- may force-disconnect an individual user's local Pipedrive connection;
- cannot use the admin page to act through a user's Pipedrive token;
- remains subject to Access authentication, exact-origin POSTs, one-shot CSRF,
  confirmation, and audit requirements.

### End User

A person allowed by Cloudflare Access who uses the supported private ChatGPT
Pipedrive app and Pipedrive. This
person:

- enters the Pipedrive company domain they want to connect;
- completes OAuth using their own Pipedrive identity;
- owns one active Pipedrive connection at a time;
- manages only their own Writes, Deletes, and Mailbox switches;
- may inspect, replace, or disconnect only their own connection.

## Terminology

- **Access user:** authenticated Cloudflare Access subject identified by the
  stable `sub` claim. Email is display and administration metadata, not the
  primary storage key.
- **Approved domain:** normalized Pipedrive company subdomain admitted by the
  platform administrator, for example `acme` for `acme.pipedrive.com`.
- **Pipedrive company:** the company returned by Pipedrive OAuth and verified
  through the current-user API. It is pinned by stable `company_id` after the
  first accepted connection.
- **Tenant:** an approved Pipedrive company identified internally by its pinned
  company ID and an opaque, non-PII correlation identifier.
- **User connection:** one encrypted OAuth grant bound to one Access subject
  and one tenant.
- **User policy:** the user's Writes, Deletes, and Mailbox choices scoped to an
  Access subject and Pipedrive company pair.

## Accepted Product Decisions

| Surface | Decision |
| --- | --- |
| Tenant admission | Global allowlist of Pipedrive company domains. |
| User membership | Any Access-allowed user who can authenticate as a member of an approved Pipedrive company may connect it. |
| Stable tenant identity | The entered domain is verified at callback and pinned to Pipedrive `company_id`. |
| Connection cardinality | One active Pipedrive company per Access user in V1. |
| Replacement | A successful connection to another approved company atomically replaces the prior connection. |
| Migration | Clean reconnection; the legacy singleton token is never assigned automatically. |
| Capabilities | User-managed, read-only by default, scoped by `(Access sub, company_id)`. |
| Domain suspension | Immediate block for new OAuth and all existing MCP calls; encrypted tokens remain subject to the normal 90-day inactivity retention window. |
| Domain selection | The user enters the domain before OAuth; approved domains are never listed publicly. |
| Platform administration | One global platform administrator through `REMOTE_ADMIN_EMAIL`. |
| Admin PII | The admin UI may show full Access email, connected domain, status, and operational dates; it must not show Pipedrive user name or email. |
| Disconnect authority | The user may disconnect themselves; the platform administrator may force-disconnect a user with confirmation and audit. |
| Inactive-token retention | Purge encrypted OAuth material after 90 days without a successful MCP call. |

## Trust And Authorization Model

Every connection and MCP call passes three independent gates.

### Gate 1: Cloudflare Access

- Verify the signed Access assertion, issuer, audience, expiry, and stable
  subject exactly as today.
- A user not admitted by Access cannot view connection pages, start OAuth, or
  call MCP tools.
- Pipedrive domain approval does not add a user to Access or change Access
  policies.

### Gate 2: Tenant Admission

- The normalized domain must exist in the global registry with status
  `active` before OAuth starts.
- The same approval must remain active at OAuth callback and on every MCP call.
- `suspended` blocks all new and existing use immediately.
- The registry never exposes the full list of approved domains to end users.
- User-facing responses for an unknown, unapproved, or suspended domain must
  be indistinguishable in status, content, and bounded timing behavior.

### Gate 3: Per-User Pipedrive OAuth

- OAuth state is bound to Access subject, expected normalized domain,
  redirect URI, connection generation, and expiry.
- The callback must return an `api_domain` matching the approved expected
  domain.
- Before persistence, the Worker calls the Pipedrive current-user endpoint and
  requires a valid stable `company_id`.
- On the first accepted connection for a domain, the registry pins the
  `company_id`. Later callbacks for that domain must match it.
- The encrypted token is stored only for the initiating Access subject.
- An Access email and Pipedrive email are allowed to differ; Access identity,
  OAuth membership, approved domain, and pinned company ID provide the binding.

## User Journeys

### 1. Administrator Approves A Company

1. The administrator opens `/admin/pipedrive`.
2. They enter a Pipedrive subdomain such as `acme`.
3. The service normalizes and validates the value and rejects full arbitrary
   URLs, credentials, paths, or non-Pipedrive hosts.
4. A new registry record becomes `active` with no company ID until the first
   valid OAuth connection pins it.
5. The action is confirmed, CSRF-protected, and audited without logging the
   raw administrator email.

### 2. User Connects Pipedrive

1. The user installs or enables the private ChatGPT Pipedrive app and
   authenticates through
   Cloudflare Access.
2. They open their connection page and enter their Pipedrive subdomain.
3. The Worker verifies that the domain is active before redirecting to
   Pipedrive.
4. The user signs in to Pipedrive and selects or confirms their company.
5. The callback verifies state, domain, company ID, and current membership.
6. The new credential is encrypted and committed atomically to the user's
   connection store.
7. A first connection to a new company starts with read-only policy.
8. The user returns to a success page showing the connected company domain and
   their own connection status, without displaying token material.

### 3. User Replaces Their Company

1. The current connection remains usable while a replacement OAuth flow is in
   progress.
2. A cancelled, expired, denied, unapproved, or mismatched callback leaves the
   current connection unchanged.
3. A fully verified replacement increments the connection generation and
   atomically replaces the credential.
4. Connecting a different company selects that company's user policy; a new
   `(sub, company_id)` pair starts read-only.
5. Reauthorizing the same company preserves its existing user policy.

### 4. User Uses MCP

1. The Worker verifies Access on every request.
2. It resolves the connection by stable Access subject, never from a
   user-controlled tenant header, query parameter, or tool argument.
3. It verifies that the connection's company remains active in the registry.
4. It loads only the policy for `(Access sub, company_id)`.
5. It loads, refreshes, and uses only that user's encrypted credential.
6. Audit records contain pseudonymous actor and tenant identifiers but no raw
   Access email, token, CRM payload, or Pipedrive response body.

### 5. User Or Administrator Disconnects A User

- The user may delete their own local OAuth material from their connection
  page.
- The administrator may force-disconnect a selected Access user from the
  global admin page.
- Both flows require exact method and Origin, one-shot CSRF bound to actor and
  connection generation, explicit confirmation, and an audit event.
- Disconnect invalidates pending OAuth state and prevents refresh or callback
  races from recreating the deleted material.
- Local deletion does not claim to uninstall or revoke the provider-side
  Pipedrive application grant.

### 6. Administrator Suspends Or Resumes A Company

- Suspension blocks connection starts, callbacks, refreshes, and MCP calls for
  that company immediately.
- Suspension does not immediately delete encrypted tokens or user policies,
  but it does not pause the 90-day inactive-token retention window.
- Resumption restores eligibility. If a retained token is no longer usable or
  was purged after 90 inactive days, the affected user must reconnect.
- Domain deletion and provider-wide grant revocation are not part of V1;
  suspension is the supported company-level offboarding control.

### 7. Inactive Connection Cleanup

- A successful MCP call updates bounded `lastUsedAt` metadata for that user
  connection.
- Once no successful MCP call has occurred for 90 days, encrypted access and
  refresh tokens are deleted.
- Cleanup must happen no later than 24 hours after the threshold under normal
  platform operation.
- Tenant approval, pseudonymous audit history, and user policy are not deleted
  by this token-retention rule.
- The next use produces a stable reconnect-required response.

## Administration Requirements

The global `/admin/pipedrive` experience must provide:

- add and approve a normalized Pipedrive domain;
- list approved domains with `active` or `suspended` status;
- show pinned company ID and safe company display name after first connection;
- suspend and resume a domain with explicit consequences;
- show connected-user count and limited rows containing Access email,
  connection state, domain, connected date, last successful use, and token
  expiry;
- force-disconnect one user with confirmation;
- never display access tokens, refresh tokens, Pipedrive user email/name, CRM
  data, Access assertions, encryption keys, or OAuth authorization codes.

The existing admin visual principles remain: calm, precise, consequence-first,
keyboard accessible, responsive, and free of dashboard decoration that does
not help an operator make a safe decision.

The global administrator is an explicit V1 risk acceptance: compromise of this
one account creates a cross-tenant suspension and disconnect blast radius.
This is accepted for the bounded pilot because the admin cannot use user
credentials for CRM calls, the displayed PII is limited, and every mutation is
confirmed and audited. Delegated tenant administration is deferred until the
tenant count or operating model justifies the additional role system.

The admin page must retire the current singleton pattern that live-verifies a
connection by calling `/api/v1/users/me` with stored OAuth material. Safe
company name and company ID are captured during the initiating user's callback
and read from registry metadata. The global admin page never makes a Pipedrive
API call using an end user's credential.

## User Settings Requirements

- Each user has a connection page distinct from the global admin console.
- The page shows only that user's active company and safe connection status.
- It supports connect, replace, and disconnect actions.
- `/settings` remains user-scoped and manages Writes, Deletes, and Mailbox.
- Every new `(Access sub, company_id)` policy starts read-only.
- Users may enable their own capabilities with the existing confirmation
  semantics; no domain-level capability ceiling is introduced in V1.
- Deletes remain unavailable unless Writes is enabled, and real mutations
  still require `dry_run=false`.

## Data And Persistence Requirements

### Tenant Registry

The service needs a global administrative registry containing only bounded
tenant metadata:

- normalized Pipedrive domain;
- status `active` or `suspended`;
- pinned Pipedrive company ID when known;
- safe company display name when known;
- created and updated timestamps;
- pseudonymous tenant correlation ID.

The registry must support administration and lookup without storing OAuth
tokens. Exact Durable Object topology and indexing are architecture decisions,
but enumeration must not require exposing tenant names to ordinary users.

### User Connection Store

Each Access subject has one active logical connection store containing:

- encrypted OAuth material;
- verified domain and company ID;
- connection generation;
- connected, last-used, and expiry timestamps;
- one-shot OAuth and action state required by the current security model.

The stable Access `sub`, or an irreversible keyed derivation of it, is the
connection key. Email must not be used as the durable identity key.

Physical Durable Object topology is an architecture decision. It may shard by
user, tenant, or a derived `(user, tenant)` key only if it preserves the logical
one-active-connection-per-user contract and proves cross-tenant isolation.
The earlier provisional requirement for a company-keyed `TENANT_SECRETS`
object is therefore superseded. Suspension is enforced by checking the trusted
registry on every OAuth, refresh, and MCP path, not by assuming a particular
storage shard.

### User Policy Store

Permissions are keyed by `(Access sub, company_id)`. A policy from Tenant A
must never be reused for Tenant B. Switching away from and later returning to
the same company may restore that pair's previous policy.

Policy records contain capability booleans and revision metadata, not OAuth
material. They are retained in V1 even when the associated token is purged so a
return to the same company can restore the user's confirmed choices. Automatic
policy cleanup is deferred; it must not be inferred from the 90-day token rule.

### Administrative Connection Index

The administrator needs a bounded index from tenant to user connection
metadata for support, suspension enforcement, cleanup, and force-disconnect.
The index may retain the Access email required by the approved admin UI, but it
must never place that email in audit events or public diagnostics.

## Security And Privacy Requirements

- Preserve AES-256-GCM encrypted OAuth material and independent audit HMAC
  keys.
- Preserve transactional connection generations and anti-resurrection checks
  for exchange, refresh, replacement, and disconnect.
- Bind OAuth and CSRF records to the authenticated actor and expected tenant.
- Check active tenant admission before and after every provider network call
  that could persist or refresh credentials.
- Never accept tenant selection from MCP tool inputs or unverified headers.
- Never use a token from a different Access subject as fallback.
- Never fall back to the legacy singleton credential.
- Keep admin and user POST actions exact-origin, method-restricted,
  confirmation-protected, one-shot, and no-store.
- Pseudonymize actor and tenant identifiers independently in audit logs.
- Keep Access email confined to the authenticated admin UI and bounded
  administrative storage.
- Prevent unbounded tenant or user enumeration from unauthenticated and normal
  user routes.
- A suspended tenant must fail closed even if registry or connection state is
  temporarily inconsistent.

## Migration From The Singleton

The multi-tenant release uses a clean cutover:

1. The new request path never reads the `TENANT_SECRETS` object named `tenant`.
2. The existing singleton token is not assigned to `REMOTE_ADMIN_EMAIL` or any
   Access subject.
3. Existing sub-only `USER_POLICY` records are not copied to a tenant. Every
   user-company pair starts read-only and the user reconfirms capabilities.
4. Alexandre and every other user complete a new per-user OAuth connection.
5. There is no transitional fallback from a missing user credential to the
   old singleton.
6. The encrypted singleton may remain untouched for a bounded passive
   inspection window, but no application path may read or use it during that
   window. This is not a functional fallback. It remains application-unreadable
   through B9 exit and for at most 14 days after cutover; production cleanup
   must complete before B10 customer onboarding under separate explicit
   irreversible authorization after the accepted no-read-path, per-user
   credential, rollback-independence, and redacted-audit-receipt proofs.
7. Promotion requires evidence that all intended users are using per-user
   credentials before the singleton is removed.

## Error And Recovery Contract

The implementation must expose stable, non-sensitive outcomes for at least:

- domain not approved;
- domain suspended;
- expected domain and callback domain mismatch;
- company ID and pinned company mismatch;
- no user connection;
- user reconnect required;
- stale OAuth state or connection generation;
- unauthorized admin or cross-user action;
- inactive token purged;
- tenant registry unavailable;
- user connection storage unavailable.

Errors must tell the user or operator which safe action to take without
including provider responses, credentials, raw Access claims, or CRM data.
For ordinary users, unknown, unapproved, and suspended domains share one
non-enumerable public error contract and the same registry lookup path. The
implementation must use a bounded latency-normalization strategy and must not
return early based on record presence. Detailed state is available only in the
authenticated platform-admin console and pseudonymous audit metadata.

## Acceptance Criteria

### Tenant Isolation

1. User A connects approved Tenant A and User B connects approved Tenant B.
2. Concurrent reads from both users return only records visible to their own
   Pipedrive identity.
3. User A cannot select Tenant B through URL, form tampering, OAuth state,
   headers, MCP arguments, policy identifiers, or Durable Object routing.
4. User A's refresh, disconnect, callback, and settings changes cannot mutate
   User B's material or policy.
5. Audit events correlate actor and tenant pseudonymously without exposing
   either identity.

### Admission

1. An Access user entering an unapproved domain cannot start OAuth.
2. An approved domain whose callback returns another API domain is rejected.
3. A domain pinned to one company ID rejects a later mismatched company ID.
4. The list of approved domains is inaccessible to ordinary users.

### Lifecycle

1. A failed replacement leaves the prior working connection unchanged.
2. A successful replacement to another tenant starts with read-only policy.
3. Suspension blocks existing MCP traffic, new OAuth, callbacks, and token
   refreshes immediately, including operations already in flight before they
   can persist new material.
4. Resumption permits retained valid connections without cross-tenant state
   changes; connections purged after 90 inactive days require OAuth again.
5. User and administrator disconnects delete only the selected user's local
   credential and cannot be undone by an in-flight refresh or callback.
6. A token reaches local deletion within 24 hours after 90 days without a
   successful MCP call.

### Administration And Privacy

1. Only `REMOTE_ADMIN_EMAIL` can manage the allowlist or other users.
2. The admin UI exposes only the approved limited identity fields.
3. No token, Pipedrive user identity, Access assertion, CRM response, or raw
   email appears in logs, MCP errors, or public diagnostics.
4. Every approval, suspension, resumption, and force-disconnect is confirmed
   and audited.

### Concrete Pilot

The sandbox validation uses two real test identities after generic automated
Tenant A/Tenant B tests pass:

- Alexandre connects Pezzos Labs with Alexandre's Pipedrive identity.
- Romain connects the client's approved company with Romain's Pipedrive
  identity.
- Each runs `pipedrive_connection_check` and a known read-only query.
- The returned company and records must match the caller, including under
  interleaved and concurrent requests.

## Non-Goals For V1

- Multiple simultaneous Pipedrive companies per Access user.
- Per-tenant or delegated client administrators; V1 deliberately accepts the
  bounded blast radius of one platform administrator.
- Invitations or manual user-to-tenant assignments.
- Automatic modification of Cloudflare Access membership.
- Public display or discovery of approved domains.
- Tenant-level capability ceilings or per-user permission administration.
- Provider-side Pipedrive uninstall or grant revocation automation.
- Destructive company deletion and bulk credential purge; suspension is the
  V1 company offboarding mechanism.
- Automatic migration or claiming of the singleton OAuth credential.
- Production audit-retention implementation, Logpush/R2 setup, billing action,
  or legal-hold execution. The accepted policy is a 90-day Logpush export to a
  dedicated production R2 bucket with controlled access, automatic expiry, and
  documented legal hold; live setup remains a separate production gate.
- Pipedrive app promotion from draft to live, production deployment, or client
  onboarding as part of the implementation commit.

## Mapping To Existing Multi-Tenant Readiness Notes

The provisional checklist in `docs/REMOTE_MCP_CLOUDFLARE.md` remains useful but
is refined by this PRD:

| Existing readiness concern | Product resolution |
| --- | --- |
| Trusted tenant context | Access `sub` resolves the user connection; verified and pinned Pipedrive `company_id` resolves the tenant. |
| Durable Object per tenant | OAuth credentials are per Access subject, with a global token-free tenant registry; exact DO topology is an architecture choice. |
| Tenant-scoped administration | Replaced by one platform admin for allowlist/suspension and self-service user OAuth; admin actions must still target exactly one tenant or user. |
| Permissions by `(tenant,user)` | Required as `(Access sub, company_id)`. |
| OAuth/CSRF/generation tenant binding | Required for domain, company ID, actor, redirect, generation, and expiry. |
| Tenant-safe audit | Required through independent pseudonymous actor and tenant identifiers. |
| Migration and cross-tenant tests | Clean reconnection, no singleton fallback, and mandatory Tenant A/Tenant B plus Alexandre/Romain validation. |

## Delivery And Promotion Gates

Implementation may be completed and validated locally without authorizing:

- Cloudflare deployment;
- Durable Object migration execution against live state;
- secret changes;
- Cloudflare Access policy changes;
- Pipedrive application promotion to live;
- Git push, merge, release, marketplace publication, or client onboarding.

Before production promotion, the operator must separately approve and verify:

- Pipedrive private app distribution status and callback;
- Cloudflare migration and rollback plan;
- named-pilot Access membership, Alexandre's temporary administration, and the
  accepted distinct backup operator with validated access/recovery;
- durable Logpush-to-R2 audit export, 90-day retention, controlled access,
  email alerting, and the B0 cost caps;
- the concrete Alexandre/Romain isolation acceptance sequence.

## Product And Design Principles

1. Explain consequences before confirmation.
2. Keep read-only as the visible default.
3. Prefer fail-closed tenant isolation over automatic recovery or fallback.
4. Never require an end user to handle a token, secret, or client credential.
5. Show users only their own connection and authority.
6. Show the platform administrator only the minimum identity needed for safe
   support.
7. Keep all destructive or authority-increasing actions explicit and
   reversible where possible.
8. Meet WCAG 2.2 AA for contrast, keyboard operation, focus, labels, status
   announcements, error identification, and reduced-motion preferences.

## Approved V1.1: Trustworthy And Actionable Extension

### Release Boundary

The capabilities in this section form the approved V1.1 product package. They
do not block implementation, local validation, or release of the multi-tenant
V1 defined above. V1.1 starts only after the multi-tenant isolation and
per-user OAuth acceptance criteria are satisfied.

V1.1 improves everyday confidence and usefulness without widening the
underlying Pipedrive authority model. It adds:

1. a complete connection diagnostic;
2. automatic capability detection;
3. guided repair;
4. an optional account reminder before real writes;
5. duplicate protection;
6. safe links to Pipedrive records;
7. three additional business workflows;
8. a read-only pipeline hygiene audit.

These are one product package but may be implemented and validated in three
coherent slices:

1. diagnostic, capability detection, and guided repair;
2. account reminder, duplicate protection, and Pipedrive links;
3. business workflows and pipeline hygiene audit.

Each slice must preserve the multi-tenant trust boundary. No V1.1 feature may
read another user's connection, infer another tenant, weaken dry-run defaults,
or make a write without the user's exact approval.

### Shared Terms And Defaults

- **Real write:** an operation that sends a Pipedrive API request which creates,
  modifies, links, moves, completes, archives, or deletes CRM data. Reads,
  dry-run previews, capability probes, diagnostic metadata writes, audit
  records, and local preference changes are not real Pipedrive writes.
- **Account identity:** the verified Pipedrive company and the initiating
  user's own Pipedrive identity. It is never derived from a tool argument.
- **Identity revision:** a per-Access-user revision incremented by every
  successful OAuth credential commit, including reauthorization for the same
  company. It is distinct from the retained `(Access sub, company_id)` policy
  identity.
- **User-operation scope:** the combination of Access subject, company ID, and
  verified Pipedrive user ID. Pending workflow and duplicate-protection state
  from one scope is never visible or reusable in another.
- **Capability snapshot:** a timestamped, non-sensitive assessment of which
  features are available, unavailable, degraded, or still unknown.
- **Exact replay:** reuse of the same approved operation identity and normalized
  payload, not merely a new request that happens to contain similar text.
- **Probable duplicate:** a new create operation that resembles a recent
  operation or existing Pipedrive record closely enough to require review but
  is not an exact replay.
- **Analysis coverage:** the bounded records, pages, owners, pipelines, and time
  window actually inspected by a briefing or audit. It is not test coverage and
  must never imply that an incomplete scan represents the whole tenant.
- **Domain configuration:** a setting owned by the platform administrator and
  scoped to one pinned Pipedrive company. Ordinary users cannot modify it.
- **Sandbox status:** an administrator-declared domain property. The allowed
  values are `production` and `sandbox`; an absent or legacy value is treated
  as `production`, which is the more restrictive default. No name- or
  domain-based heuristic may silently classify an environment.

Every successful OAuth credential commit invalidates that Access user's
pending previews, write approvals, and workflow resumes by changing the
identity revision. It does not:

- invalidate another Access user's state, including another user in the same
  company;
- remove the reconnecting user's retained policy for the same
  `(Access sub, company_id)` pair;
- alter an already completed Pipedrive write;
- expose a completed-operation result from one verified Pipedrive identity to
  another identity.

Completed duplicate-protection state remains partitioned by
user-operation scope for the rest of its 24-hour retention. Reauthorizing as
the same Pipedrive user preserves that completed replay protection.
Reauthorizing as a different Pipedrive user starts a separate operation scope;
the old scope is neither invalidated for other users nor exposed to the new
identity.

Diagnostic and capability-probe calls do not update the V1
`last successful MCP use` retention clock. Only a successful Pipedrive tool
that reads or writes CRM business data postpones the 90-day inactive-token
purge.

All V1.1 domain-configuration mutations, including environment classification,
required account reminders, stale-deal thresholds, and critical-field
mappings, inherit the V1 admin mutation contract: authenticated platform admin,
exact method and Origin, one-shot CSRF, explicit consequence and confirmation,
no-store response, and pseudonymous audit.

The user's optional reminder preference is not a domain configuration and does
not require platform-admin authority. It inherits the V1 user-settings
contract: authenticated Access subject, self-only target, exact method and
Origin, one-shot CSRF, explicit consequence, no-store response, revision
checking, and pseudonymous audit. Changing one user's preference cannot mutate
another user's preference or the domain requirement.

The user reminder preference and the domain reminder requirement are separate,
non-aliased settings. The effective OR rule combines their values at request
time; neither setting overwrites the other.

The phrase `domain stale threshold` refers only to the number of inactive days
used by morning briefs and hygiene findings. It is not a logging, audit-event,
rate-limit, or security threshold.

User-visible results must behave consistently through the private ChatGPT
Pipedrive app on the unified ChatGPT desktop app (with Codex) and ChatGPT Web.
The PRD makes no promise for a surface that cannot install or use the required
connector. No workflow may depend on local desktop-only filesystem state.

### 1. Complete Connection Diagnostic

#### User Outcome

An authenticated user can answer, in one explicit diagnostic:

- whether the connector and Pipedrive API are reachable;
- whether their OAuth credential is accepted;
- which Pipedrive company they are using;
- which Pipedrive identity they are using;
- whether the domain is declared as production or sandbox;
- which capability restrictions currently apply;
- when the result was checked and whether it is live or cached;
- what safe action to take when something is wrong.

This must make a wrong-company or wrong-user connection obvious before the user
relies on CRM results.

#### Current Foundation

- `pipedrive_health_check` provides a local, no-network configuration
  diagnostic and must retain that narrow meaning.
- `pipedrive_connection_check` performs a live credential check and currently
  exposes technical connection state and a bounded current-user identifier.
- Multi-tenant connection storage already knows the verified company, domain,
  connection generation, dates, and last successful MCP use.

V1.1 extends the live diagnostic. It does not turn the local health check into
a provider call.

#### Functional Requirements

The live diagnostic returns a stable structure containing:

- connection validity, provider reachability, authentication validity, and
  authentication mode;
- verified company ID, safe company name, normalized domain, and declared
  environment;
- the current user's Pipedrive ID, active state, display name, and email;
- connected date, last successful MCP use, credential-expiry status, and
  reconnect status;
- a summarized capability snapshot;
- `checked_at`, `source: live | cached`, and snapshot age;
- a structured repair action when the connection is not fully usable.

The user's own Pipedrive name and email may appear only:

- in that authenticated user's explicit diagnostic result;
- in that user's own connection settings;
- in an account reminder shown to that same user.

They must never appear in the platform-admin UI, administrative index, audit
events, ordinary logs, public errors, another user's response, or telemetry.
If cached, they must remain inside the user's protected connection boundary and
must not be copied into tenant-wide metadata.

A normal diagnostic may reuse a live snapshot no more than five minutes old.
The response must always show its age. An explicit live recheck is allowed but
must be rate-limited to at most one provider check per user per minute. A
rate-limited recheck returns the recent snapshot and a safe retry time rather
than failing the whole diagnostic.

#### Failure And Recovery

- A missing or purged credential returns `reconnect_required`.
- Rejected credentials return `authentication_failed`.
- A suspended or unavailable tenant remains subject to the V1
  non-enumeration contract.
- Rate limits and provider outages return their stable capability and repair
  states without exposing provider bodies.
- An unexpected identity or company mismatch fails closed and directs the user
  to reconnect; it never silently changes the pinned tenant.

#### Acceptance Criteria

1. A user connected to a sandbox sees `environment: sandbox` in the top-level
   diagnostic summary and a visible warning adjacent to the exact company and
   own-user identity declared by Pipedrive.
2. A user connected to production sees their own identity without exposing it
   to the platform administrator, logs, audit, or another user.
3. Live and cached results are distinguishable and include freshness.
4. Repeated checks respect the rate limit without losing the most recent safe
   diagnostic.
5. `pipedrive_health_check` remains local and makes no provider request.

### 2. Automatic Capability Detection

#### User Outcome

The supported ChatGPT Pipedrive app knows which Pipedrive features are usable
before proposing or attempting
a workflow. Missing OAuth scopes, disabled user policy, unavailable Pipedrive
suites, and temporary provider failures produce different explanations and
different repair actions.

#### Capability Model

Capabilities are assessed independently across four layers:

1. **Product policy:** Writes, Deletes, Mailbox, and any domain-enforced
   capability ceiling.
2. **OAuth grant:** scopes actually available to the user's credential.
3. **Pipedrive subscription:** suites or resources available to the connected
   company, including Projects and Mailbox where applicable.
4. **Runtime health:** temporary provider availability, rate limits, and probe
   freshness.

Each capability has:

- `status: available | unavailable | degraded | unknown`;
- a stable `reason_code`;
- `checked_at` and freshness;
- whether a user action, platform-admin action, or Pipedrive-plan action is
  required;
- a safe repair action when one exists.

`unavailable` is used only when absence is known. Failed or inconclusive probes
produce `unknown` or `degraded`, never a false claim that the feature is
unsupported.

The account reminder is reported separately as an effective policy flag
containing `user_enabled`, `domain_required`, and `effective`. It is not
assigned a provider capability status such as `unavailable` or `degraded`.

#### Detection And Refresh

- Build a capability snapshot after a successful OAuth connection or
  reauthorization.
- Re-evaluate local policy immediately after the user or administrator changes
  an applicable setting.
- Refresh provider-derived capabilities when the snapshot is older than 24
  hours, when the user explicitly rechecks, or after a stable provider error
  indicates that the snapshot may be stale.
- Use only read-only, minimal-data probes. Capability detection must not return
  CRM content such as email subjects, addresses, bodies, notes, or record
  lists.
- Capability probes share bounded rate-limit handling and must not fan out
  unbounded provider calls.

When a capability is definitively unavailable, the supported ChatGPT Pipedrive
app must not recommend a
workflow that depends on it. Where dynamic tool catalogs are supported, the
unavailable tool may be omitted. Otherwise, invocation returns a stable
`capability_unavailable` result with the same structured repair object.
Capabilities in `unknown` state may remain usable, but the supported ChatGPT
Pipedrive app must state the
uncertainty and handle a safe provider rejection.

Exact Pipedrive scope, entitlement, suite, and error mappings must be verified
against supported provider behavior before implementation. Unknown mappings
must remain `unknown`; the product must not infer paid-plan entitlements from a
single ambiguous error.

#### Acceptance Criteria

1. Projects unavailable because of the connected Pipedrive plan are
   distinguished from missing OAuth scope and temporary provider outage.
2. A user-disabled write policy is distinguished from a provider restriction.
3. No capability probe writes CRM data or exposes probed CRM content.
4. The supported ChatGPT Pipedrive app omits or safely declines an unavailable workflow before partial
   execution begins.
5. Snapshot freshness and last probe outcome are visible in the connection
   diagnostic.

### 3. Guided Repair

#### User Outcome

Every recoverable connection or capability failure tells the user what happened
in plain language, who can fix it, and the next safe action. Users are not sent
to generic administration pages without context.

#### Repair Contract

Recoverable MCP and settings errors use a stable object containing:

- `error_code`;
- `user_message`;
- `action`;
- an allowlisted same-origin `action_url` when a web action exists;
- `retryable`;
- `requires_user`, `requires_platform_admin`, or
  `requires_pipedrive_admin`;
- a bounded correlation ID when support investigation is appropriate.

Required action families include:

- reconnect the user's Pipedrive account;
- inspect the connected company and user;
- choose the intended approved domain;
- ask the platform administrator to approve or resume a domain;
- enable the user's own Writes, Deletes, or Mailbox policy;
- ask a Pipedrive administrator to grant a scope or install/enable a suite;
- retry after a bounded provider or rate-limit delay;
- re-run capability detection.

Repair URLs must be constructed from allowlisted application routes. Provider
error URLs, response bodies, OAuth codes, tokens, raw Access claims, and CRM
content must never become repair links or messages.

Guided repair may navigate, explain, or start an authenticated OAuth flow. It
must never change a user policy, domain policy, Pipedrive subscription, or CRM
record automatically.

#### Acceptance Criteria

1. Wrong account, missing scope, missing suite, suspended domain, expired
   credential, provider outage, and rate limit lead to distinct safe actions.
2. The response states whether the user, platform administrator, or Pipedrive
   administrator owns the next step.
3. A repair action never includes a secret or trusts a provider-supplied URL.
4. After a successful repair, the diagnostic and capability snapshot refresh
   without requiring connector reinstallation.

### 4. Optional Account Reminder Before Real Writes

#### User Outcome

When enabled, the supported ChatGPT Pipedrive app reminds the user exactly
which Pipedrive company and
identity will receive a write before the user authorizes it. This reduces
wrong-account writes for consultants, sandbox users, and people who recently
reconnected.

#### Configuration And Precedence

- Each `(Access sub, company_id)` policy has a user preference to show the
  reminder. It defaults to off.
- Each approved domain has a platform-admin setting that may require the
  reminder.
- A domain requirement is an immutable minimum: a user may enable the reminder
  when the domain does not require it, but cannot disable an active domain
  requirement.
- The effective value is the logical OR of the user preference and the domain
  requirement.

The domain rule depends only on the pinned company and domain metadata. It does
not require the platform administrator to see the user's Pipedrive name or
email.

#### Reminder And Approval Binding

When effective, the reminder appears exactly once immediately before every
real write or approved multi-step write batch. It does not appear for reads or
dry-run previews.

The reminder contains:

- safe company name and normalized domain;
- production or sandbox label;
- the current user's own Pipedrive display name and email;
- the exact operation or batch summary;
- a clear statement that approval will perform a real Pipedrive write.

Approval is bound to the Access subject, company ID, identity revision,
effective reminder policy, and exact normalized operation or batch. A changed
connection, company, identity revision, policy, or payload invalidates the
approval and requires a new reminder.

The reminder must use verified connection metadata or a fresh-enough protected
identity snapshot. It must not add an unconditional `/users/me` request before
every write. The snapshot must be no more than five minutes old. If identity
confidence is insufficient or the snapshot is older, the write is paused and
guided repair requests a diagnostic or reconnect.

#### Acceptance Criteria

1. A platform-required reminder cannot be disabled by an end user.
2. A user may enable the reminder for themselves on a domain that does not
   require it.
3. Every real write and exact multi-write batch is covered when the effective
   setting is enabled.
4. An approval issued for Tenant A or an older identity revision cannot be
   reused for Tenant B or after reconnect.
5. The user's Pipedrive identity remains invisible to the platform
   administrator and logs.
6. A reminder never uses an identity snapshot more than five minutes old.

### 5. Duplicate Protection

#### User Outcome

Retries do not silently create duplicate CRM records. Exact replays are safe
without another confirmation, while probable duplicates remain possible after
the user reviews the evidence and explicitly overrides the warning.

#### Exact Replay Protection

Every approved create or multi-step write receives an operation identity bound
to:

- user-operation scope;
- identity revision while the operation is pending;
- tool or workflow step;
- normalized payload fingerprint;
- preview and approval identity.

Replaying the same operation within 24 hours returns the original bounded
result with `replayed: true` and performs no new provider write. The response
does not interrupt the user with another confirmation.

A domain reminder-policy change invalidates an approval for a write that has
not executed yet. It does not change the identity of an already completed
write. A completed exact replay still returns its existing bounded result and
never sends another provider mutation merely because the reminder policy
changed.

An ambiguous provider outcome is stored as `uncertain`. Before retrying a
provider write, the service performs a bounded reconciliation using known
provider IDs or safe matching fields. It never blindly repeats a write whose
outcome is unknown.

#### Probable Duplicate Detection

For new create operations, the service checks recent bounded evidence relevant
to the entity:

- target and activity type, subject, and due date for activities;
- target and normalized content fingerprint for notes;
- normalized name and primary links for contacts, organizations, deals, and
  leads;
- completed workflow-step identities for composite workflows.

A probable duplicate returns:

- `duplicate_warning`;
- candidate record type, ID, safe label, and Pipedrive link when available;
- the bounded reasons for the match;
- material differences from the proposed write;
- an explicit override path tied to a new preview and approval.

Similarity never causes automatic deletion, merge, update, or permanent block.
The user may confirm that a legitimately repeated action should be created.

#### Storage And Retention

Exact replay and probable-duplicate state are both retained for 24 hours. The
store contains only bounded operation keys, hashes, provider record IDs,
timestamps, statuses, and step outcomes. It must not store note bodies, email
content, CRM payloads, Access email, or Pipedrive user identity.

The durable guarantee applies to the remote service. A standalone skill pack
without the remote state service must not claim durable idempotence; it may
still perform best-effort read-before-write checks and must disclose that
limitation.

#### Acceptance Criteria

1. Retrying an identical approved create within 24 hours creates exactly one
   Pipedrive record and returns the original result.
2. A similar but distinct create produces an actionable warning and may proceed
   only through an explicit override.
3. An uncertain timeout never triggers a blind second provider write.
4. Tenant A, User A, one verified Pipedrive identity, or one workflow step
   cannot reuse Tenant B, User B, another verified Pipedrive identity, or
   another step's operation identity.
5. Retention cleanup removes dedupe state after 24 hours without touching CRM
   records.
6. A reminder-policy change invalidates an unexecuted approval but cannot turn
   a completed exact replay into a second provider write.

### 6. Safe Pipedrive Record Links

#### User Outcome

Read results, write receipts, duplicate warnings, workflows, and hygiene
findings include a direct link to the relevant Pipedrive record when a safe,
verified route is known.

#### Link Contract

- Use a stable field such as `pipedrive_url`, or an equivalent consistent
  `_links.pipedrive` field, for supported records.
- Support at least persons, organizations, deals, activities, leads, projects,
  project tasks, and notes where Pipedrive exposes a verified browser route.
- Derive the browser origin only from the verified normalized company domain.
- Use allowlisted record-type route templates and validated record IDs.
- Never forward or trust an arbitrary URL from a provider response, tool
  argument, CRM field, or error.
- Never generate production links for loopback or mock API origins.
- Omit the link with a stable `link_unavailable` reason when no verified route
  exists; do not guess a URL.
- Links are response metadata only and must never be injected into CRM payloads.
- Every response containing a link also carries the verified
  `environment: production | sandbox` value. Sandbox links are accompanied by
  a visible sandbox indicator in the surrounding response.

API origins and browser UI origins must be normalized separately if Pipedrive
requires different hosts. Exact route templates, especially for UUID leads,
projects, project tasks, and notes, must be verified before implementation.

#### Acceptance Criteria

1. A supported record returned by a verified tenant includes a link for that
   same tenant and record ID.
2. Cross-tenant, hostile-host, path-injection, and unsupported-record inputs
   cannot generate a link.
3. Links appear consistently in normal reads, write receipts, duplicate
   warnings, workflow output, and hygiene findings.
4. Unsupported records degrade safely without making the underlying operation
   fail.

### 7. Additional Business Workflows

All workflows use only the caller's visible Pipedrive data and the current
capability snapshot. Missing optional capabilities are stated explicitly; they
do not cause the supported ChatGPT Pipedrive app to invent unavailable context.

#### Morning Sales Brief

The morning brief is read-only and defaults to the current Pipedrive user's
visible records. It summarizes:

- overdue and due-today activities;
- open deals without a next activity;
- open deals with no meaningful activity for at least the domain's configured
  stale threshold;
- material missing standard fields detected by the hygiene rules;
- direct Pipedrive links and a suggested next action.

The brief is prioritized and bounded rather than an unfiltered CRM dump. It
shows analysis coverage, snapshot time, omitted capabilities, and whether more
records remain. It performs no automatic remediation.

#### Meeting Preparation

Meeting preparation resolves an explicit person, organization, deal, lead, or
meeting and produces a read-only brief containing:

- verified participant and company context;
- active deal, stage, value, and next activity when available;
- recent notes and activities;
- recent mail context only when Mailbox capability is enabled and explicitly
  relevant;
- open commitments and overdue follow-ups;
- a proposed agenda and questions clearly labelled as suggestions;
- links to the source records.

Ambiguous targets require disambiguation. Missing Mailbox, Projects, or other
optional capabilities are disclosed rather than treated as empty CRM data.

#### Controlled Meeting Report

A meeting report may propose an exact batch containing:

- one meeting or call note;
- completion of the source activity;
- explicit deal or contact field/status updates requested by the user;
- creation of a next activity.

The supported ChatGPT Pipedrive app first presents one complete dry-run preview
listing every step, target,
payload summary, account identity, and expected effect. One explicit approval
authorizes that exact batch. Any added or changed step requires a new preview
and approval.

Pipedrive does not provide a cross-resource transaction for this workflow. The
product must not describe the batch as atomic. Each step has its own operation
identity and result. On partial failure, the response lists:

- completed steps and provider record IDs;
- pending or uncertain steps;
- failed steps with guided repair;
- a resume action that executes only missing, reconciled steps.

Workflow and per-step resume state lasts 24 hours. After expiration, the service
must re-read the relevant Pipedrive records and build a new preview. It never
resumes or writes automatically from expired state and never attempts an
automatic compensating rollback.

#### Packaging And Surface Requirements

The new workflows are delivered as explicit skills wherever that packaging is
supported:

- paid plugin users receive the skills with the remote connector;
- the standalone skill offer may include the same guidance, but must state
  which durable remote guarantees are unavailable without the service;
- plugin and standalone manifests, skill archives, documentation, version
  coupling, and package smoke tests remain synchronized;
- workflow behavior must not depend on a desktop-only local filesystem and
  must remain usable on the accepted ChatGPT desktop and web surfaces.

`Paid plugin` is a distribution and packaging distinction only. It does not
add an authorization gate and never replaces Cloudflare Access, domain
admission, or per-user Pipedrive OAuth.

#### Acceptance Criteria

1. The morning brief returns a deterministic ordered list, the rules used for
   ordering, and the exact analysis coverage without writing.
2. Meeting preparation distinguishes unavailable context from genuinely empty
   data.
3. One meeting-report approval authorizes only the exact displayed batch.
4. Retrying or resuming within 24 hours never repeats completed steps.
5. Resuming after 24 hours requires a fresh read, preview, and approval.
6. A partial failure is visible and recoverable without claiming transaction
   rollback.

### 8. Read-Only Pipeline Hygiene Audit

#### User Outcome

An authenticated user can request a bounded, explainable audit of the
Pipedrive records visible to their own identity. The audit identifies practical
cleanup opportunities without changing any record.

#### Default Rules

V1.1 evaluates at least:

- open deals with no next activity;
- open deals with no meaningful activity for 30 days by default;
- overdue open activities;
- deals missing owner, value, organization, or person where those fields are
  relevant;
- persons and organizations missing administrator-configured critical standard
  fields;
- project hygiene only when the capability snapshot confirms Projects access.

The platform administrator may configure the stale-deal threshold per domain.
The default is 30 days. Every audit and morning brief for that domain uses the
domain threshold; there is no personal threshold override in V1.1.
Custom-field semantics are excluded unless the platform administrator
explicitly maps the field and its expected meaning for that domain.

#### Result Contract

Every finding includes:

- stable reason code and `severity: high | medium | low`;
- record type, ID, safe label, and Pipedrive link when available;
- the rule and threshold that produced the finding;
- bounded supporting facts such as age, missing field names, pipeline, stage,
  and owner;
- a suggested next action clearly labelled as a suggestion.

Every audit includes:

- start and completion timestamps;
- owners, pipelines, time window, pages, and record counts inspected;
- totals by reason and severity;
- `coverage: complete | partial`;
- an opaque continuation cursor or safe instruction when more data remains;
- capability omissions, rate-limit effects, and snapshot freshness.

Large tenants are scanned through bounded pages and rate-limit-aware
continuations. A partial result must never be presented as tenant-wide
completeness. Audit state and cursors must remain scoped to the Access subject
and company ID.

The audit is on-demand in V1.1. Background scheduling, proactive notifications,
cross-tenant aggregation, and autonomous cleanup are not included.

Any remediation uses the ordinary read, dry-run, duplicate, reminder, and
approval contracts. The audit itself never enables writes or changes CRM data.

#### Acceptance Criteria

1. The same fixture produces deterministic reason codes and severity.
2. A 30-day stale threshold is the default and a domain configuration changes
   it without affecting another tenant.
3. A partial scan clearly reports its actual coverage and continuation.
4. Missing optional capabilities create omissions, not false clean results.
5. Tenant and user isolation applies to findings, cursors, cached summaries,
   and links.
6. Running the audit performs no Pipedrive mutation.

### V1.1 Cross-Feature Acceptance

V1.1 is accepted only when:

1. A user connected to the wrong sandbox or company can identify that fact
   through the diagnostic before a write.
2. Unavailable Projects or Mailbox capability is detected and explained before
   a dependent workflow partially executes.
3. A guided repair leads to the correct user, platform-admin, or
   Pipedrive-admin action without exposing secrets or provider payloads.
4. A required domain account reminder is shown for every real write and cannot
   be disabled by the user.
5. Exact retries within 24 hours create no duplicate, probable duplicates
   require an override, and uncertain outcomes are reconciled before retry.
6. Safe Pipedrive links always target the caller's verified company.
7. Multi-step meeting reports are approved as one exact batch, report partial
   completion honestly, and resume without repeating completed work.
8. Morning briefs and hygiene audits expose their actual data coverage and
   never modify CRM records.
9. Tenant A/User A cannot read or mutate Tenant B/User B diagnostic snapshots,
   capabilities, preferences, operation ledger, workflow state, audit cursors,
   links, or results.
10. The same remote product behavior is available on the accepted ChatGPT
    desktop and web surfaces without relying on desktop-only local state.
11. Environment, reminder, stale-threshold, and critical-field domain changes
    use confirmation, CSRF, exact-origin, no-store, and pseudonymous audit.
12. Another user's OAuth connection or reauthorization cannot invalidate,
    expose, or reuse the caller's pending or completed operation state.
13. Reauthorizing the same Access user invalidates only that user's pending
    previews, approvals, and workflow resumes; retained same-company policy
    remains unchanged.
14. Diagnostics and capability probes do not postpone inactive-token cleanup,
    while successful CRM data reads and writes do.

### V1.1 Non-Goals

- Autonomous repair, autonomous capability or permission elevation, and
  automatic Pipedrive subscription changes.
- Automatic CRM writes from diagnostics, briefings, or hygiene findings.
- Transactional guarantees or automatic compensating rollback across multiple
  Pipedrive API resources.
- Heuristic sandbox classification.
- Persistent storage of diagnostic Pipedrive identity in tenant-wide admin
  metadata, logs, or audit.
- Durable idempotence claims for a standalone skill-only installation without
  the remote state service.
- Guessed deep-link routes for unsupported Pipedrive record types.
- Scheduled audits, proactive notifications, cross-tenant rankings, or
  platform-wide sales analytics.
- Automatic interpretation of tenant custom fields without explicit
  administrator mapping.
- Supporting a surface that does not expose the required private ChatGPT app
  connector capability.

### V1.1 Delivery And Validation Gates

Implementation must separately validate:

- privacy-safe diagnostic output and cache/rate-limit behavior;
- capability mappings against supported Pipedrive OAuth, suite, and error
  behavior;
- guided-repair codes and allowlisted action routes;
- domain/user reminder precedence and approval invalidation;
- exact replay, probable duplicate, ambiguous provider outcome, cleanup, and
  cross-tenant isolation;
- every deep-link route template and hostile-input rejection;
- workflow preview, partial failure, 24-hour resume, expired-state rebuild, and
  manifest/package synchronization;
- hygiene rule determinism, threshold isolation, bounded pagination, coverage,
  and no-write behavior;
- connector and workflow behavior on each accepted ChatGPT surface.

Real provider probes, ChatGPT-surface acceptance, deployment, publication,
secrets, production data, and client onboarding remain external promotion
gates requiring separate authorization.
