# Support runbook

Support is best effort, owned by **Alexandre**, the sole current owner and alert recipient; Davy Guittard of Keilintech is designated future D08 backup, not informed or accepted, with no access or validated recovery. There is no 24x7 coverage and no contractual SLA. Email alert routing is a placeholder and is not configured; this runbook makes no claim that any live alert or support action occurred.

## Intake and safe data boundary

Open a redacted ticket with the requester, approved contact channel, reported time, severity, pseudonymous request/event ID, tenant pseudonymous ID, deployment version, route name, status/error code, and bounded timestamp range. These are the only identifiers safe to request.

Never collect or paste OAuth tokens, API keys, secrets, cookies, authorization headers, raw provider payloads, CRM records, customer content, names, email addresses, phone numbers, or other PII into a ticket. Query and reproduce only with pseudonymous IDs and the bounded metadata above.

## Executable intake, severity, and acknowledgement flow

1. Confirm the reporter's authorized contact route and record the safe intake fields.
2. Classify the report as Informational, Warning, or Critical using impact, tenancy, access, and data-exposure signals.
3. Acknowledge on a best-effort basis through the approved customer contact; do not promise a response deadline or SLA.
4. Query logs and reproduce with pseudonymous IDs only. Redact findings before adding them to the ticket.
5. For a Critical report, suspected data/access incident, or integrity concern, apply the **D13 freeze** under authorized authority and preserve evidence.
6. Escalate incident handling to the incident runbook; escalate access/security concerns to security, legal-hold or contractual questions to legal, and personal-data questions to privacy.
7. Send an approved customer response only after the authorized reviewer approves its scope and redactions.

## Recovery and closure

The recovery target is one business day and the RPO is 24h; both are planning targets, not guarantees. Do not resume a frozen action without authorized approval.

Use this redacted ticket and closure template:

```text
Ticket ID: <pseudonymous-id>
Safe identifiers and time range: <redacted>
Severity / acknowledgement: <classification and best-effort timestamp>
Investigation and reproduction: <pseudonymous IDs only>
D13 freeze / escalation: <status and approved route>
Approved customer response: <approval reference and redacted summary>
Closure: <authorized approver, outcome, evidence hash>
```

Close only when the approved response, escalation outcome, and redacted evidence receipt are recorded. Keep the email alert route marked placeholder/not configured until a separately authorized live configuration exists.
