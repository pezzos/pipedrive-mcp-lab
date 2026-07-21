# B7 audit operations local receipt

Date: 2026-07-21 (Europe/Paris)

Status: `in_progress`

Scope: deterministic local verification only; no external effects were performed.

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

## Live/external checks: NOT RUN / UNPROVEN

- Cloudflare Logpush delivery.
- Dedicated R2 durability, queryability, 90-day retention, and legal-hold behavior.
- Alert email receipt and acknowledgement.
- Live sandbox trace query.
- Live billing signals.

## Gates and boundaries

D08 is designated-not-activated: Davy Guittard of Keilintech still requires notification, acceptance, least-privilege access provisioning, and recovery validation. Exact `SW` authorization/configuration remains a live gate. B7 remains `in_progress`; no external effects are claimed. Privacy and legal drafts are **NON-FINAL** pending post-B9/pre-B10 finalization.
