# B1 V1 baseline evidence

## Identity and scope

- Candidate: `9de8d0c69daeb6cd4a882d66a8e231eacf7f314b` (`fix(remote): align per-user sandbox acceptance`).
- Main baseline: `8dcb634cb49cf66e46b99d5b03e0a551f4f71742`.
- Program: `docs/PRODUCTION_EXECUTION_PROGRAM.md` (B1).
- B0 decisions: `docs/decisions/B0-production-decisions.json` (SHA-256 `4019c37742a578c0ba598fd8657cb936d981699036c1df99fd537fe352de3bd9`).
- Candidate descends from main; its merge base is main. The candidate-to-main diff has 13 paths, 177 additions, and 52 deletions. This B1 pass starts at `f33cc028080e3ddb6928b7dc9aa69d66f03c80be`, where the candidate is an ancestor and the two later commits are documentation-only production-program records.

## Local qualification record

- Scope: build/test plumbing, direct concurrency tests, focused remote runbook command, B1 evidence, and B1 progress only. No decision was consumed or changed.
- Preserved invariants: one `USER_CONNECTION` Durable Object keyed by Access subject; policies keyed by `(sub, company_id)`; token-free global registry with admission/suspension checks; no v2 `TENANT_SECRETS` binding, route, or fallback (legacy class export remains migration-compatible only); generation-bound callback/refresh anti-resurrection; 90-day encrypted-material purge; bounded, redacted admin projection/audit behavior.
- Reviews: original Sol PASS and security-specialist PASS after remediation; both results are recorded without raw review transcripts. Parent-controlled local versioning remains separate and has no claimed commit SHA.
- External effects: none. No network/live system, secret, OAuth, customer data, deployment, publication, or credential operation occurred.

## Verification

Run locally with metrics disabled where Worker construction occurs:

```sh
WRANGLER_SEND_METRICS=false npm run build:worker
node --import tsx --test tests/oauthErrors.test.ts tests/remoteSecurity.test.ts tests/remoteState.test.ts tests/tenantRegistry.test.ts tests/userConnection.test.ts tests/remoteWorker.test.ts tests/pipedriveAdminPage.test.ts tests/workerdDurableObjects.test.ts
WRANGLER_SEND_METRICS=false npm run check
npm run benchmark:server
npm test
npm pack --dry-run --json
git diff --check
```

Results: the focused eight-suite command passed 51/51 tests; `WRANGLER_SEND_METRICS=false npm run check` passed 118/118; `npm run benchmark:server` passed with p95 3.34ms against its 20ms limit; and post-benchmark `npm test` passed 118/118. `npm pack --dry-run --json` reported a stable 21 package files, and a manifest assertion passed for exclusion of `evidence/**`, source, tests, workflow logs, secret-named files, and raw validation notes. `npm test` builds the Worker first and remains valid after the benchmark rebuilds `dist`. `npm ci --offline` succeeded from cache and `npm audit --audit-level=high --offline` reported no vulnerabilities; that audit is cache-backed and non-fresh.

## Rollback and remaining gates

- Rollback remains limited to a v2-compatible code rollback; this B1 record neither restores a legacy singleton nor reverses migrations or credentials.
- No singleton purge, provider grant revocation, or credential reversal is implied.
- Remaining gates are parent final validation and local atomic commit, then separately authorized push/PR. Sandbox and live acceptance remain B8 work; later live gates remain governed by B0, including the D08 backup-operator prerequisite for B7--B10 live or credentialed work.
- Next block after B1 completion: B2, private ChatGPT app and canonical workflows.
