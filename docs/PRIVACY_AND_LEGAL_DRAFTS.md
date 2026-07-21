# Privacy and legal drafts

**NON-FINAL. NOT LEGAL ADVICE.** Legal approval is required after B9 and before B10. This packet records draft language and unresolved decisions; it does not claim a contract, configuration, notice, or compliance outcome exists.

## 1. Privacy notice draft

Pilot scope: the service connects an authorized Pipedrive account to the product. Controller/processor identity, contact, purposes, legal basis, regions and transfers are placeholders requiring approval. Draft data categories: Access identity used transiently; pseudonymous audit IDs; safe tenant/company metadata; encrypted OAuth secrets (stored but never audited); and support identifiers. Recipients/subprocessors require verification. Production audit retention is 90 days, subject to controlled versioning/expiry and legal hold; audit writes are pipeline-only. Draft rights workflow: contact `[privacy contact]`, verify requester, scope/export/redact/review, then respond on an approved timeline. Security summary: least access, encryption, pseudonymous auditing, and controlled exports; no guarantees or SLA are offered.

Checklist: [ ] controller/processor roles [ ] legal basis [ ] contacts [ ] regions/transfers [ ] notice approval [ ] pilot/customer wording.

## 2. DPA schedule draft

Roles, documented instructions, data subjects/categories, purpose and duration are placeholders. The schedule must cover confidentiality, controlled access, security controls, subprocessor authorization/change process, DSAR assistance, incident/breach assistance with a notice-period placeholder (no invented deadline), deletion/return subject to legal hold, audit evidence, and regions/transfers. Liability and commercial terms remain unresolved.

Template: `Customer instructions: [ ]`; `authorized subprocessors: [ ]`; `breach notice period: [legal decision]`; `return/deletion method: [ ]`; `transfer mechanism: [ ]`.

## 3. Subprocessor register draft

| Provider | Purpose | Data categories | Region/transfer | Status/contact/change notice |
| --- | --- | --- | --- | --- |
| Cloudflare | hosting, access, export plumbing | [verify] | [verify] | verify/finalize later |
| Pipedrive | customer CRM integration | [verify] | [verify] | verify/finalize later |
| OpenAI | product/provider dependency where enabled | [verify] | [verify] | verify/finalize later |

Pipedrive may be an independent service/controller subject to the customer account; classification is unresolved. No row is an assertion of an executed agreement.

## 4. DSAR runbook

1. Intake and receipt; verify requester identity and authority.
2. Confirm scope, tenant boundary, legal-hold/conflict check, timeline and legal-basis placeholders.
3. Search approved systems; export, redact, and review with tenant isolation.
4. Route access, deletion, correction, restriction, or objection requests to the approved decision owner.
5. Approve secure delivery; record receipt/evidence fields: request ID, verifier, scope, systems searched, hold decision, approver, delivery receipt, closure.

Do not disclose secrets, another tenant, or unapproved audit material.

## 5. Breach-response pack

Intake → triage/severity → containment/freeze → preserve evidence → determine scope, data and subjects → legal assessment → regulator/customer notification decision by `[legal decision owner]` and statutory-deadline placeholders → approved communications → remediation/recovery → postmortem/closure.

Redacted evidence template: `incident_id`, `time_window`, `systems`, `containment`, `scope`, `hold`, `decision_owner`, `notification_decision`, `receipts`, `next_review`; exclude account, bucket, email, token, and secret values.

## B0 and approval boundaries

Production is planned as a dedicated R2 export path with 90-day retention, pipeline-only writes, controlled versioning/expiry/legal hold, and Alexandre-only reads while D08 is designated-not-activated. There is no 24x7 commitment or SLA; RTO is one business day and RPO is 24h best effort; budgets remain approval-bound. Sandbox bucket, retention and read access are user-owned placeholders; use a separate-bucket recommendation. D08 backup is a hard gate. Final acceptance is post-B9 and pre-B10.
