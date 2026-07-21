# Offboarding runbook

Accepted D09 assigns owner **Alexandre**. Davy Guittard of Keilintech is D08 designated-not-activated; second-person verification is blocked until notification, acceptance, least-privilege access provisioning, and recovery validation. This is a preparation runbook, not a claim that any live action occurred.

## Trigger and authorization

Record operator or customer offboarding variant, authorized requester, scope, freeze authority, tenant/customer boundary, legal-hold conflict, and approved deletion/return authority.

## Executable checklist

1. Freeze destructive changes under approved authority.
2. Revoke Access, admin access, and user sessions; perform the supported per-user local disconnect and Worker-held credential deletion.
3. Perform the supported tenant suspension; remove secret/key access. Tenant/domain deletion is outside PRODUCT V1 and routes to a future/legal/operator decision.
4. Review Logpush/R2 read and write access, recovery credentials, and alert/dashboard ownership transfer.
5. Preserve 90d retention; do not delete under legal hold. Perform deletion/return only with authority.
6. Create a redacted immutable receipt containing case ID, scope, approvals, local actions, any separately authorized external action, timestamps, hashes, and closure result.
7. Obtain second-person verification only after D08; close with authorized approval.

## Variants and closure

Operator offboarding includes role/session/key removal and ownership transfer. Customer offboarding includes tenant suspension, per-user local disconnect/Worker-held credential deletion, retention/legal-hold review, and approved return/deletion routing. Provider-grant revocation is a separately authorized external action and is not implied by local disconnect. Tenant/domain deletion is outside PRODUCT V1; route it to a future/legal/operator decision. Escalate conflicts to legal/security placeholders; never infer authority.
