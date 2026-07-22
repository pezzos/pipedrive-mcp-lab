# Audit and observability

## Implemented local audit contract

The Worker emits bounded, marked `pipedrive.audit` native v3 JSON records to console. Native v3 provides fields and context under a strict **<=4KiB** record limit. The JSON schema, runtime validator, and offline audit-operations reader have equivalent acceptance rules; v1/v2 are reader-only compatibility formats and are not emitted by the Worker.

The signal matrix covers:

| Signal | Implemented record context |
| --- | --- |
| Access/JWKS | access outcome, JWKS availability/error class |
| OAuth | connect, reconnect, refresh, and disconnect lifecycle outcomes |
| Authority | tenant/authority decision and administrative context |
| Capacity | Durable Object capacity at warning 80 and critical 100 |
| Provider | provider class, timing, and attempt count |
| Routes | protected, general, and MCP route outcomes with latency/error context |
| DO boundary | Durable Object boundary and purge delay signals |
| Export | `audit.export.heartbeat` freshness signal |

This is source emission only. Delivery is Logpush-only: there is no direct R2 binding and no direct R2 write. There is no claim of live durability or live routing.

## Local operational preparation

## Derived operational signals

`request_count` is emitted by Worker v3 where representative. Parse failures come from `audit_export_validator` and its invalid marked-record count. Request and CPU signals come from `cloudflare_platform_logpush`; DO/R2 storage comes from usage inventory; provider and observability cost come from an approved billing cost ledger. Every pipeline, platform, inventory, and billing source is `not_configured` and unproven. The Worker does not fabricate CPU, storage, cost, or parse values.

The repository includes local dashboard, alert, and evidence templates. They are preparation artifacts, not proof of configured live dashboards, alert delivery, or recovery. Cost thresholds are 8/10 for observability and 20/25 for combined cost, in the template currency and approval context.

Best-effort recovery targets one business day with an RPO of 24h. These are not guarantees: there is no contractual SLA and no 24x7 coverage.

## Production policy and gates

Any production export requires a dedicated R2 bucket with 90d retention, pipeline-only writes, controlled immutability, expiry, legal hold, and Alexandre-only reads while Davy Guittard of Keilintech is D08 designated-not-activated; notification, acceptance, least-privilege access provisioning, and recovery validation remain required before activation. The exact live gates are accepted **D08** and **SW** approval; neither is implied by local artifacts.

Only B7/B8 may use the separate named sandbox before D08 completion, after a recorded unpaid informed-testing receipt, safe expected records, Alexandre-only reads/alerts, and exact authority. Customer billing, additional-customer access, real production data or traffic, public availability, or security incident stops that exception; a security incident requires closure and fresh authority. B9/B10, production, billing, and expansion remain completed-D08 gated. This creates no live durability, routing, or current-effect claim.

Sandbox export uses its own dedicated R2 bucket, separate from production, with 30-day retention, pipeline-only writes, controlled immutability/expiry/legal hold, and Alexandre-only reads. This accepted sandbox policy does not provision the bucket or authorize live configuration by itself; exact `SW` remains required.

Privacy/legal text is final only after B9 and before B10. Until the gates and live configuration are accepted, this document explicitly makes no live durability/routing claim.

## 2026-07-22 limited sandbox cutover evidence

The append-only `ops/evidence/B7-live-cutover-2026-07-22.json` receipt records a limited synthetic sandbox delivery through the dedicated private R2 bucket: five objects at five-minute cadence, one sampled raw-byte integrity check, one successful offline `audit.export.heartbeat` query, a bucket-limited credential cutover with the old credential revoked, and authority-linked removal of the obsolete Logpush configuration. The final observed-object timestamp is recorded separately; without a revocation timestamp, it is not evidence of post-revocation delivery. Locked-object UI state showed Delete disabled; no audit object was deleted. This is narrow sandbox evidence, not production durability or routing proof, which remains future scope outside B7.

The Cloudflare Logpush-failure notification test was submitted once, but email receipt and acknowledgement are pending; the repository makes no sent or delivered claim. D08 remains designated-not-activated, and the five sandbox stop triggers remain false. No Pipedrive access/change, production effect, public route, external-party access, or customer-data deletion occurred. The alert recipient was observed Alexandre-only, but strict Alexandre-only reading is not proven: the active one-bucket Object Read & Write Logpush credential is a technical principal and no durable exhaustive reader/token inventory exists. The B7 blockers are email receipt/acknowledgement, the exhaustive B7 sandbox validation packet, and remaining non-backup live checks, including that reader boundary.

The previous pending-alert statement is superseded for the receipt/acknowledgement state only by append-only `ops/evidence/B7-alert-email-ack-2026-07-22.json`. It records the redacted, hash-only appshot evidence of the signed `notify.cloudflare.com` test notification at minute precision, a recipient hash matched to the prior alert, and the operator's appshot capture/share acknowledgement at `2026-07-22T12:14:55.928Z`—after the receipt-minute interval, not at the same minute. It does not retain raw headers or message material, does not establish an actual live job failure, and grants no further live authority. The alert blocker is closed; the B7 blockers are now the exhaustive B7 sandbox validation packet and remaining non-backup live checks, including unproven `read_access_alexandre_only` and actual-live-job-failure notification.
