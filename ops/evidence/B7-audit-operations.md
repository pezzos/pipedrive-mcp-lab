# B7 audit operations local receipt

Date: 2026-07-21 (Europe/Paris)

Status: `in_progress`

Scope: this document records deterministic local verification. The separate hash-verified live-configuration and live-deployment-remediation receipts record limited Cloudflare sandbox configuration, an isolated synthetic heartbeat, and destination validation; they do not establish B7 completion.

## Receipt hashes

| Artifact | SHA-256 |
| --- | --- |
| `ops/audit/audit-event-v3.schema.json` | `8776e496752579832282ddff44e8ed3f3db01caeb2aa9a2f07b6aec5c83f5bd3` |
| `scripts/lib/audit-equivalence-fixtures.mjs` | `238aa356be9b52abf2527383c72c4ffc52a77f2df571f041552e6735e2cf0666` |

## Local commands and observed outcomes

| Command | Observed outcome |
| --- | --- |
| `node --import tsx --test tests/audit.test.ts tests/auditOperations.test.ts tests/auditEquivalence.test.ts tests/remoteWorker.test.ts tests/userConnection.test.ts tests/pipedriveClient.test.ts tests/workerdDurableObjects.test.ts tests/workerProvenance.test.ts` | 78/78 passed |
| `npm run validate:audit-operations` | PASS |
| `npm run validate:worker-topology` | PASS |
| `git diff --check` | PASS |
| `WRANGLER_SEND_METRICS=false npm run check` | 203/203 passed |
| `npm run build:worker:production` | Dry-run PASS; production bindings limited to `USER_POLICY`, `USER_CONNECTION`, `TENANT_REGISTRY`, `VERSION_METADATA`, `DEPLOY_ENVIRONMENT`, and `PUBLIC_ORIGIN`; no R2 binding/write and no external effect |
| `npm pack --dry-run` | PASS; 28 files, 81.1 kB package, shasum `6942650f306272757ab5f44a4426e017fb118344` |
| `npm run benchmark:server` | PASS; p95 3.271ms under 20ms, mean 1.469ms |
| `npm audit --offline --omit=dev --audit-level=high` | 0 vulnerabilities |

## What this local evidence proves

- The shared valid/invalid corpus classifies audit records consistently across the runtime validator, offline parser, and Draft 2020 AJV schema; the byte limit remains an explicit runtime/parser control.
- The audit contract rejects tampering and unsafe shapes, including invalid nested structures, correlation fields, provider variants, unknown fields, and invalid UTF-8-safe identifiers.
- Request correlation is locally exercised across Worker events and internal UserConnection calls; hostile public correlation headers are not forwarded as internal audit IDs.
- Worker topology and provenance checks pass, including tamper detection.
- The marked-record offline reader/query path is bounded for input, decompression, line, record, aggregate, and output limits.

These are local code and fixture outcomes only. They do not prove live export durability, alert operation, or third-party service state.

Remediation verification: targeted audit, parser, and AJV-equivalence tests passed 13/13 after canonical UUID, route, context, and paired-correlation parity checks were added. This does not rerun or replace the prior full-suite receipt.

## Live/external configuration: partial / remaining proof unproven

- Proven configuration: dedicated sandbox R2 with 30-day lifecycle and lock, pipeline-only filtered Logpush job, destination-validation write connectivity, and Alexandre-only alert configuration.
- The prior Worker-absent state is historical and superseded, not erased. A clean exact archive of remediation commit `b99479c1043a9611de69304c8063f9f0fb8e68bc` now proves an isolated sandbox Worker and exactly one successful synthetic `audit.export.heartbeat`, with no Pipedrive, public, route, or production effect. The current-session SW+DW authorization is recorded only as current-session authority; no chat-authority hash was invented, and DW cleanup remains unperformed.
- Actual Worker trace delivery, immutable export receipt, queryability, and 30-day lifecycle/lock behavior under real audit data remain unproven.
- Alert email receipt and acknowledgement.
- Live sandbox trace query.
- Hard cost enforcement; the observed USD warning and zero billable usage are not enforcement proof. Browser control was unavailable and the API read returned auth 403; neither caused a mutation.

## Gates and boundaries

D08 is designated-not-activated: Davy Guittard of Keilintech still requires notification, acceptance, least-privilege access provisioning, and recovery validation. Exact `SW` authorization is recorded in the expurgated, hash-verified `B7-sw-authority.json` receipt, issued 2026-07-21 and expiring 2026-07-22 at 23:59 Europe/Paris. The hash-verified `B7-live-configuration.json` records partial Cloudflare sandbox configuration: dedicated locked 30-day R2, pipeline-only Logpush configuration, destination-write connectivity, and Alexandre-only email alert configuration. The hash-verified `B7-live-deployment-remediation.json` records the later isolated Worker heartbeat remediation; it supersedes the earlier Worker-absent narrative without proving trace delivery, immutable export, queryability, or alert acknowledgement. B7 remains `in_progress`; legal/privacy drafts are **NON-FINAL**.

The sandbox policy is accepted as a dedicated R2 bucket, 30-day retention, pipeline-only writes, and Alexandre-only reads. The expurgated, hash-verified `B7-pilot-exception.json` records an operator-owned self-pilot acceptance for Alexandre's own Pipedrive account. For B7 it permits synthetic audit records only, no Pipedrive access, no external-party access, no charge, and no SLA/24×7. The five stop triggers remain active. This receipt creates no bucket or live configuration by itself.

When recorded, the sandbox receipt must be revalidated within 30 days of its review date. Its incident ledger receipt is the immutable, monotone anchor for containment, closure, and renewed authority; verification must follow the ledger chain rather than infer a cleared incident from current flags.

Read-only gate verification uses `node scripts/validate-audit-operations.mjs --evidence <path> --block B7 --as-of <ISO> --prior-incident-head <hash> --prior-incident-ever-triggered false --expected-candidate-binding <hash>`; use `--customer-effect true|false` for B8 only. The prior head must come from the last verified immutable receipt, and the expected candidate binding must come from the independently accepted candidate receipt, never from the candidate evidence packet.

The current exact `SW` expires at `2026-07-22T21:59:00.000Z`. After that point, Logpush use, configuration mutation, and testing are prohibited without fresh exact SW, except the already-authorized expiry rollback. That rollback is limited to disabling Logpush and alerts, retaining objects to their expiry, and no destructive delete. The token outlives SW through observed date 2026-08-20: renewal is prohibited without fresh exact token and SW authority. The earlier live-configuration receipt correctly records that revocation was not authorized at its observation time; the current session now authorizes exact `DW` cleanup, including old-token revocation, but that cleanup has not yet been performed. The isolated Worker deployment does not discharge those gates: B7 progression remains blocked on execution of the authorized DW token cleanup, then trace delivery, immutable receipt, queryability, and alert-ack proof work.

## 2026-07-22 sandbox cutover receipt (append-only)

`B7-live-cutover-2026-07-22.json` is a hash-verified, secret-free, partial sandbox receipt recorded at `2026-07-22T11:37:26Z`; its B7 status is exactly `in_progress`. It chains the earlier SW, pilot, live-configuration, and remediation receipts. Its structured, redacted authority link records the exact current-session `SW + DW` operator scope for old-token revocation and permanent obsolete Logpush-job configuration deletion, explicitly excluding R2 object deletion. The source-material SHA-256 is a digest of a redacted authority statement, not a chat/transcript hash. It records a private dedicated WEUR Standard R2 bucket with 30-day retention and bucket lock, object deletion disabled, and the new one-bucket Object Read & Write credential active through 2026-08-21. The old credential was revoked and absent after refresh; no credential value, access key, token, bucket name, account identifier, or object identifier is recorded.

The new `workers_trace_events` Logpush job has an isolated prefix and ScriptName pipeline-only filter. Five distinct scheduled objects arrived at 300-second cadence; one sampled object passed its recorded raw-byte SHA-256 check. The last observed object's hash and `2026-07-22T11:32:03Z` modification timestamp are recorded as separate facts, without a claimed relation to the credential-revocation time. Object detail showed `application/json`, Standard storage, 624 bytes, and Delete disabled. The offline parser/query observed one valid record, zero invalid records, and one successful `audit.export.heartbeat` match. This supersedes only the stale claims that trace delivery, queryability, and DW cleanup were still unperformed: the old credential is revoked and the obsolete old Logpush job configuration was permanently deleted under the recorded authority scope. It was not merely disabled; no R2 object was deleted.

One Cloudflare Logpush-failure test notification was submitted between `2026-07-22T11:13:18Z` and `2026-07-22T11:15:17Z`. There was no success toast, so this receipt does not claim email sent, email delivery, or acknowledgement; both receipt and acknowledgement remain pending. The accepted fresh full local gate was the sequential command `WRANGLER_SEND_METRICS=false npm run build:worker --silent && node --import tsx --test --test-concurrency=1 tests/*.test.ts`, passing 229/229. The normal parallel `WRANGLER_SEND_METRICS=false npm run check` built but is an invalid concurrent run at 223/225 because of two shared-`dist` packaging collisions (ChatGPT lifecycle and worker provenance), not an accepted full gate.

D08 remains designated-not-activated: Davy Guittard of Keilintech is not informed or accepted and has no access or recovery validation. All five stop triggers remain false. There was no Pipedrive access or change, production effect, public route, external-party access, audit-object deletion, or customer-data deletion. The alert recipient was observed Alexandre-only, and Davy/third-party access was not observed. That does not prove Alexandre-only read access: the active one-bucket Object Read & Write Logpush credential is a technical principal and there is no durable exhaustive reader/token inventory. `read_access_alexandre_only` remains within the remaining non-backup live checks. This proves limited synthetic sandbox delivery, sampled byte integrity, the offline query, locked-object UI delete state, credential/job cutover, the separately recorded last-object timestamp, and alert-test submission only. B7's current blockers are alert email receipt/acknowledgement, the exhaustive B7 sandbox validation packet, and remaining non-backup live checks. Production durability/routing is a future scope limit outside B7, not a B7 blocker. B7 stays `in_progress`.

## B7 email receipt and acknowledgement (append-only)

`B7-alert-email-ack-2026-07-22.json` is a hash-verified, secret-free receipt chained to the cutover receipt `e4c8ea22cfc6028847e162d6960175c156469c9d6a968e7617d6477140dc3a6e`. Its source is an operator-supplied appshot represented only by a redacted source digest: no appshot, raw headers, raw message, sender, recipient, or subject is retained. The receipt minute is `2026-07-22T13:15:00+02:00` / `2026-07-22T11:15:00Z`, minute precision only. It overlaps the recorded submission window but makes no second-order timing claim. The recipient hash is linked to the predecessor alert recipient, while the sender and subject remain hash-only; the signed domain is `notify.cloudflare.com`.

The fixture hashes prove a test notification only. They do not prove an actual live job failure, which remains false/unproven. The operator acknowledgement is recorded at the appshot capture/share timestamp `2026-07-22T12:14:55.928Z`, after the minute receipt interval, and grants no further live authority. This closes only the alert email receipt/acknowledgement blocker. The current blockers are now the exhaustive B7 sandbox validation packet and remaining non-backup live checks; `read_access_alexandre_only` and actual-live-job-failure notification remain unproven within those checks. Production durability/routing remains a future scope limit outside B7. D08 remains designated-not-activated, all five stop triggers remain false, and no Pipedrive, production, public-route, external-party, audit-object-deletion, customer-data-deletion, Cloudflare/Gmail mutation, or R2-object-deletion effect is claimed. B7 remains `in_progress`.

## 2026-07-22 SR and SW validation authorities (no effect yet)

`B7-sr-authority-2026-07-22.json` and `B7-sw-validation-authority-2026-07-22.json` are separate hash-verified, redacted current-session grants, each issued at `2026-07-22T12:52:15.000Z` and expiring `2026-07-23T21:59:00.000Z`. They chain the cutover and alert-ack receipts and bind the dedicated bucket, sandbox Worker, and operator hashes. They record no raw chat/transcript or identifier material, expected incremental charge EUR 0, and the EUR 10 observability / EUR 25 combined ex-tax controls.

SR authorizes only the listed receipt-bound read and metadata enumeration. SW authorizes only the listed isolated sandbox validation packet, including synthetic-only checks and reversible controls. Neither receipt records a live effect. The SW rollback requires restoration before expiry; a disposable failing Logpush job may be disabled or quarantined only, with no deletion, and R2 objects must be retained. Any public route, unspecified deployment, Pipedrive/OAuth/CRM, customer/Davy, billing, secret/token mutation, or deletion remains excluded. The next action is execution of the authorized packet; B7 remains `in_progress`.

## 2026-07-22 sandbox validation observation (append-only, partial)

`B7-sandbox-validation-observation-2026-07-22.json` records the SR inventory and the one SW effect actually completed. The account had one active human member linked to the operator hash; the sandbox Worker had no public URL, domain, or route; the accepted Logpush job was observed as the only enabled job and was not changed; the dedicated bucket remained private with enabled 30-day lifecycle and lock rules; and current-period R2 billable usage displayed USD 0. The 24-hour Worker dashboard query returned 202 invocations, zero subrequests, zero errors, and no external host result. One fresh provider sample test for the failing-Logpush notification was confirmed; no Gmail read or delivery claim is made. Logpush nevertheless reported `No activity`, with its last push 6,066.41 seconds before the observation ended versus the established 300-second cadence. Export freshness is therefore failed, independently of the provider sample-alert test.

The exhaustive packet cannot pass. R2 metadata showed three reader-capable technical principals: one bucket-scoped Object Read & Write principal and two all-buckets Admin Read & Write principals. Therefore `read-access-Alexandre-only` is failed, not merely unproven, even though no additional human member or unauthorized access was observed. The next gate is a separate exact SR for read-only dependency and usage impact mapping across those three principals. Only after the affected targets are hash-bound may an exact SW authorize replacement or scope reduction and a separate DW authorize revocation; neither later mutation is granted by the current authority. An explicit product/security boundary decision is the non-remediation alternative, not live authority. Permission-toggle, tenant suspend/resume, and recovery exercises were not run because no safe internal control plane exists without a public route, unspecified deployment, or credential mutation. No disposable failing job was created because no isolated failure destination was available without a new raw secret or an unapproved external endpoint. B7 remains `in_progress`; the stale Logpush export, reader boundary, exhaustive packet, internal-control-plane checks, and actual-live-job-failure notification remain blockers, while all five stop triggers remain false.
