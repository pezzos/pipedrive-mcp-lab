# ADR-0001: Production Delivery Contract for the Private Pilot

- **Status:** Accepted for the B0 private pilot contract
- **Decision date:** 2026-07-20
- **Decision owner:** Alexandre / platform operator
- **Evidence:** Explicit B0 operator decisions recorded on 2026-07-20, aligned
  against the checked-in product, remote-MCP, and operator documentation. This
  ADR records no live configuration, customer data, deployment, publication,
  credential, or destructive action.

## Context

The implemented multi-tenant Worker is a sandbox-qualified technical baseline.
It does not by itself decide production distribution, operating ownership,
retention, budgets, customer commitment, or irreversible cleanup. The private
pilot needs one coherent, reviewable contract before later blocks implement or
operate those concerns.

## Decisions

### Scope and customer surface

1. The V1 release is a named private pilot for Pezzos Labs and one authorized
   customer. It is not publicly available.
2. The first-class customer surfaces are the unified ChatGPT desktop app (with
   Codex) and ChatGPT Web. Codex CLI and IDE remain technical/operator
   fallbacks and are not a customer promise.
3. Pipedrive distribution is private or unlisted for the named pilot companies;
   ChatGPT installation is private to the named pilot workspaces/users.
4. The pilot contains one complete private ChatGPT Pipedrive app with all seven
   canonical workflows. It does not split them into thematic bundles.
5. Existing Claude delivery remains a compatibility path during V1 only. It
   gains no new surface or acceptance promise, and Claude is never used for
   this program's planning, implementation, review, or execution.

### Environment and CRM boundary

1. Sandbox and production use separate Pipedrive OAuth applications,
   callbacks, secrets, and identifiers.
2. The existing Pezzos Labs Cloudflare account is accepted, with strictly
   separate sandbox and production Workers, Access apps/audiences,
   namespaces/bindings, secrets, and hostnames. The account-level shared blast
   radius is accepted for this pilot.
3. Each CRM has its own externally distinct MCP. The production Pipedrive MCP
   endpoint is `https://pipedrive-mcp.pezzoslabs.com/mcp`; sandbox remains
   separately named and configured. A future `crm-mcp.pezzoslabs.com` may add
   orchestration or discovery only; it cannot replace CRM-specific endpoints
   without a new ADR and program rebaseline.
4. Shared libraries and operations infrastructure are permitted. Credentials,
   OAuth clients, registries, policies, keys, and migration state are not
   shared across CRMs.

### Operating model, audit, and service level

1. Alexandre is the sole temporary production administrator and owns support,
   incident command, and offboarding for the named pilot. This is an accepted
   concentration risk, not a TBD.
2. **Narrow sandbox exception:** Davy Guittard of Keilintech remains the designated future backup, not informed or accepted, with no access or validated recovery. Only B7 live audit/operations validation and B8 acceptance work may proceed in the separate named sandbox for Pezzos Labs and one existing authorized pilot customer, after a redacted receipt records development/in-progress disclosure, testing acceptance, no charge, and exact action authority. It waives only the active-backup prerequisite; Alexandre remains the sole current administrator, audit reader, support/incident/offboarding owner, and alert recipient, with no 24/7 or SLA. Customer billing, additional-customer access, real production data or traffic, public availability, or a suspected or confirmed security/tenancy/access/integrity incident immediately stops the exception; a security incident requires containment and closure plus fresh explicit authority before sandbox resumption. B9/B10, production endpoints or credentials, production data or traffic, billing, and expansion remain hard-gated until D08 notification, acceptance, least-privilege production access, and recovery validation are recorded. Pilot acknowledgement is not consent, legal basis, DPA, privacy approval, production authorization, or blanket customer-effect authority.
3. Cloudflare Logpush exports production audit events to a dedicated production
   R2 bucket. Audit retention is 90 days with pipeline-only writes,
   Alexandre-only reads while D08 is designated-not-activated, controlled
   immutability/versioning, automatic expiry deletion, and a documented legal
   hold procedure.
4. Critical alerts route by email to Alexandre only. The pilot has no 24/7
   response promise and accepts the single-route risk. Security or tenancy
   alerts freeze rollout until acknowledged. Observability is capped at EUR 10
   excluding tax per month.
5. Service is best effort, with a one-business-day recovery target and a
   24-hour RPO for configuration and audit. There is no contractual SLA.
   Pipedrive remains authoritative for CRM records, and a lost credential is
   recovered by safe reconnection.
6. The pilot is limited to two companies, four named users total, and 1,000
   tool calls per day total. Infrastructure plus observability is capped at EUR
   25 excluding tax per month, excluding existing ChatGPT and Pipedrive
   subscriptions. Onboarding freezes at 80% of any limit; no plan or quota
   increases automatically.

### Key and audit-correlation rotation

1. OAuth encryption uses versioned AES-256-GCM envelopes with a `kid`, a
   primary encrypt/decrypt key, and an old decrypt-only key. Planned rotation
   is annual; compromise rotates immediately. Re-encryption is bounded, and an
   old key retires only after zero-use evidence plus 30 days. A compromise can
   require reconnection.
2. Audit HMAC uses quarterly epochs with an explicit epoch identifier. The
   current emit key and prior correlation key are retained for at most 90 days.
   Historical logs are never rewritten. Compromise starts a new epoch
   immediately; cross-epoch correlation is bounded and administrator-only.

### Canary, legal readiness, and singleton cleanup

1. B9 is a production canary for Alexandre and Pezzos Labs only: read-only,
   using a dedicated synthetic organization, person, deal, and activity with
   no email, phone, notes, or real data; seven calendar days; and at least five
   successful active sessions. Creating that corpus is a separately authorized
   live action. A controlled canary authorization/evidence packet must accept
   exact opaque record IDs before B9; IDs never appear in public or canonical
   documentation. Writes, Deletes, and Mailbox remain disabled. Canonical
   security, isolation, and audit failures stop the canary. B8 remains a
   separate two-user/two-company sandbox acceptance.
2. Legal and privacy drafts may be prepared before the canary. The final
   privacy notice, DPA, subprocessor, DSAR, and breach-response pack is due
   after B9 and before first-customer B10; it is not a B7 completion claim.
3. The legacy singleton remains application-unreadable through B9 exit and no
   longer than 14 days after cutover. Purge must complete before B10 customer
   onboarding under separate explicit irreversible authorization after proof of
   no route, fallback, or v2 read path/binding, all intended per-user
   credentials, rollback independence, and a redacted audit receipt. Revoke a
   provider grant only when it can be safely identified without exposing a
   secret.

## Review and revisit

The decision record was last reviewed on 2026-07-20 and is reviewed again
before the relevant live gate and immediately on a security incident, operator
change, budget approach, customer-scope change, client-surface change,
retention/legal-hold request, CRM addition, key compromise, or cutover/purge
request. The structured companion record assigns the exact ISO last-reviewed
date, next review gate, and trigger per decision.

## Consequences

- Later blocks must implement and verify these decisions; this ADR is not
  evidence that any external resource or acceptance test exists.
- The designated-but-inactive D08 gate is waived only for the receipt-backed B7/B8 separate-sandbox exception; it remains a hard gate for B9/B10, production, billing, and expansion.
- Private distribution and bounded scope avoid a public-availability claim.
