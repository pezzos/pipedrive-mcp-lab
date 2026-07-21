# Incident response runbook

**NON-FINAL; no live claim, 24x7 commitment, or SLA.** Alexandre is the sole current primary and recipient. Davy Guittard of Keilintech is designated future D08 backup, not informed or accepted, with no access or validated recovery; B9/B10 and any production, billing, or expansion remain hard-gated. Customer, regulator, legal, and escalation contacts require approved placeholders.

The receipt-backed B7/B8 separate-sandbox exception does not create second-person coverage. Billing, additional-customer access, real production data or traffic, public availability, or a suspected/confirmed security, tenancy, access, or integrity incident immediately terminates it. Containment, closure, and fresh explicit authority are required before sandbox resumption; acknowledgement alone is insufficient. B9/B10, production, billing, and expansion remain completed-D08 gated.

## Scope, severity, and intake

Critical: confirmed loss, unauthorized access, integrity failure, or legal-hold risk. Warning: degraded control or threshold breach. Informational: observation requiring no containment. Intake: incident/alert ID, route, reporter, environment, worker/version, timestamps, event IDs/hashes, scope, redaction status, and approved contact decision.

## Response checklist

1. Acknowledge best effort; identify environment and version.
2. Apply D13: a security or tenancy alert freezes rollout until acknowledged; freeze destructive changes where the alert requires it.
3. Preserve redacted immutable evidence; do not copy secrets or account identifiers.
4. Diagnose through approved dashboard/query; contain, recover, and validate.
5. Resume rollout only after the alert is acknowledged and an authorized approval is recorded. Communicate only with approval; close and create postmortem/receipt.

Alert receipt template: `alert_id`, `route`, `ack`, `freeze`, `runbook`, `event_ids`, `timestamps`, `hashes`, `result`, `redaction`.

## Recovery exercise

Checklist: [ ] approved scope [ ] redacted evidence [ ] restore validation [ ] config RPO 24h [ ] audit RPO 24h [ ] one-business-day best-effort target [ ] closure. This is not a contractual guarantee.

## Legal hold procedure

Authorized requester `[placeholder]` must pass identity verification. Record case ID, scope, data/time/tenant boundaries. Preserve only scoped objects through controlled immutable/versioned production R2; suspend 90d expiry only for scoped objects. Apply least-privilege access, read logging, review cadence, DSAR/conflict review, and approved escalation. Release requires authorized approval; then resume deletion/expiry and create an immutable release/deletion receipt. Never use a sandbox/prod mixed bucket. No live claims.

## Escalation and decisions

Legal approval owns customer/regulator notification, statutory deadlines, and external communications. Contacts, decision owners, and approval records remain placeholders until finalized.
