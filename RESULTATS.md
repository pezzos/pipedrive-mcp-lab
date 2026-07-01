# RESULTATS

## Context

- Lab question: can a small local MCP expose a narrow Pipedrive surface for Claude/Codex
  without making broad CRM writes the default?
- Lab repo state: public GitHub repository.
- Public repo: <https://github.com/pezzos/pipedrive-mcp-lab>
- Current MCP surface: 61 tools, with read tools plus guarded commercial workflow
  writes for common seller actions.
- API mapping notes: see `docs/API_MAPPING.md` for live-discovered mapping behavior and
  explicit gaps.
- Real Pipedrive account: read-only validation run on 2026-05-23, followed by guarded
  disposable write validation on 2026-05-24 with credentials loaded from local `.env`.
- Account type: not independently verified by Codex; treated as a live configured
  Pipedrive account, not asserted as sandbox or trial.
- CRM data: real CRM API responses were received from the configured Pipedrive account;
  only success flags, response shapes, and record counts were captured here. No CRM
  record payloads were stored or printed in the sanitized validation summary.

## Review Gate

- review_status: approved-with-scope-change
- reviewer: claude-plan-review
- review_timestamp: 2026-05-23
- review_reason: initial plan for article/lab
- reviewed_plan_summary: Claude rejected placing the lab under the Astro site repo and
  required a separate local repo, honest wording about mocked-only evidence, comparison
  with existing MCP options, dirty-worktree preservation, and an MCP stdio integration
  test.
- material findings handled:
  - Lab moved to a dedicated standalone repository instead of the Astro site repo.
  - Article and docs must not claim live Pipedrive validation.
  - Public GitHub repo creation remains a future approval gate.
  - MCP stdio integration test added.

## Test Matrix

| Test | Status | Evidence |
| --- | --- | --- |
| TypeScript build | done | `npm run check` passed on 2026-05-23. |
| Unit config tests | done | `npm run check` passed on 2026-05-23. |
| Mocked Pipedrive client tests | done | `npm run check` passed on 2026-05-23. |
| MCP stdio tools/list and dry-run call for the original 7-tool core | done | `npm run check` passed on 2026-05-23. |
| Write-gate behavior without token | done | Dry-run succeeds without a token; non-dry-run with writes enabled first requires the write confirmation, then a confirmed attempt without a token returns a clear `PIPEDRIVE_API_TOKEN` error. |
| Read-tool MCP call against mocked HTTP API | done | `pipedrive_list_deals` calls a local mock server over stdio and sends token via `x-api-token` header, not URL query. |
| Limited live Pipedrive read on configured account | done | On 2026-05-23, an MCP stdio client called live `pipedrive_list_pipelines`, `pipedrive_list_deals`, and `pipedrive_list_activities` with writes forced off. All returned `success: true`; the captured output recorded only counts and success flags. This is informational evidence, not counted sign-off for the expanded read-only surface because sandbox or trial status was not independently verified. The activities tool later moved from the earlier v1 path to `/api/v2/activities`, so the previous live activities result covers the old endpoint path, not the new v2 response shape. |
| Mocked coverage for `search_items`, deal/product search, persons list/get, organizations list/get, stages list, leads list/get, activity types list, users current/list, notes list/get, deal files/mail/products/participants/followers, and deal/person/organization field discovery | done | `npm run check` passed on 2026-05-24 with 12 tests. The expanded MCP stdio test called each added read-only tool against a local mock API and asserted endpoint paths, filters, pagination parameters, `x-api-token` header usage, and absence of token values in URLs. |
| Mocked commercial write pack | done | `npm run check` passed on 2026-05-24 with 12 tests. The stdio test asserts dry-run does not call the API, wrong confirmation blocks the call, lead creation requires a person or organization link, every write tool sends the expected `POST`/`PATCH`/`PUT`/`DELETE` request to the mock when confirmed, and token values stay in the `x-api-token` header rather than URLs. |
| Lab-prefix write guard and dry-run link validation | done | `npm run check` passed on 2026-05-24 with 12 tests. Real writes require lab-prefixed create labels or a lab-prefixed existing target, dry-runs can use `validate_links=true` to read linked records, and dry-run payloads redact email, phone, notes, comments, content and lost reasons. |
| Lab write confirmation without shared secret | done | `npm run check` passed on 2026-05-24 with 12 tests. When writes and lab-prefix protection are enabled, `confirm_lab_write=true` authorizes lab-scoped writes without exposing `PIPEDRIVE_WRITE_CONFIRMATION`; non-lab targets are still blocked by the target read. |
| Base URL allowlist | done | Config tests reject non-Pipedrive base URLs. `PIPEDRIVE_ALLOW_MOCK_BASE_URL=true` only permits loopback mock URLs, not arbitrary hosts. |
| MCP stdio tools/list for the expanded surface | done | A one-off inventory listed 61 tools after implementation; the test suite asserts the added tools are present and read-only where applicable. |
| Live smoke for the expanded read/write surface with explicit approval | done | Operator-provided live runs on 2026-05-24 validated reads plus real lab-prefixed writes using `dry_run=false` and `confirm_lab_write=true`. The final focused retest used run suffix `MCP LAB - 2026-05-24 - AP-RETEST-1423`; no `PIPEDRIVE_WRITE_CONFIRMATION` secret was shared with the test session. |
| Live pagination and rate-limit headers across the expanded read-only surface | not-run | Still pending. |
| Real write execution against disposable CRM records | done | Across the 2026-05-24 live runs, disposable lab-prefixed organizations, persons, leads, deals, notes, activities, call/follow-up workflow activities, won/lost deals, participants, and followers were created or exercised where account state allowed it, then cleaned up. Final re-reads showed expected tombstones such as `is_deleted=true` or `active_flag=false`, or 404 for deleted leads. |
| Live product line item write | skipped | `pipedrive_list_products` returned zero live products in the configured account, so adding a product line item to a deal could not be tested without first creating or importing a product. |
| API mapping note | done | `docs/API_MAPPING.md` records live-discovered mappings for person email/phone, activity participants, lead value amount/currency, unreliable organization address behavior, and the untested live product line item path without broadening the claimed coverage. |
| Reproducible live-lab harness | mocked-done/live-not-run-after-addition | Added `npm run live:lab -- --prefix "..."` on 2026-05-24. Mocked tests prove strict preflight gates, documented dry-run with no API calls, create/read/update/close/delete sequencing for organization/person/lead/deal/note/activity, and redacted JSON/Markdown reports. A fresh real-account run with this new harness has not been executed in this session. |
| Versioned validation prompts | done | Replaced the single `TEST_PROMPT.md` file with `prompts/full-live-validation.md`, `prompts/focused-retest-mappings.md`, `prompts/product-line-item-retest.md`, and `prompts/read-only-smoke.md`. These prompts separate full live validation, targeted mapping retests, product-only retests, and read-only smoke without expanding live coverage claims. |
| GitHub Actions CI | added/local-checked | Added `.github/workflows/ci.yml` to run `npm ci`, `npm run check`, `git diff --check`, a basic secret marker scan, and `npm audit --audit-level=high`. Local command results are recorded below; remote GitHub execution is pending the next push or pull request. |
| Public repo secret scan | done | Local pre-publish `rg` scan passed on 2026-05-23; GitHub secret scanning is expected to run after public push. |
| Public GitHub repo creation | done | `pezzos/pipedrive-mcp-lab` was created public and pushed on 2026-05-23. |

## Current Allowed Conclusion

The current lab supports this conclusion: the local MCP server is structurally runnable
over stdio, exposes an expanded 61-tool read/write lab surface, keeps real writes behind
explicit gates, can be tested without real CRM data, and has been live-tested for the
core CRM workflow on disposable lab-prefixed records with explicit operator approval.

It must not support this conclusion: the MCP is production-ready, it fully replaces the
Pipedrive UI, it is safe to use on customer CRM data without a separate permission
model, or it is validated for product line items, email send/sync, file upload/download,
reports, dashboards, automations, webhooks, real pagination, rate limits, OAuth, or
remote hosting.

## Commands Run

- `npm install`: installed 98 packages, audited 99 packages, 0 vulnerabilities reported.
- `npm run check`: first run failed because the TypeScript build emitted
  `dist/src/server.js` while the MCP stdio test spawned `dist/server.js`.
- `npm run check`: passed after scoping `tsconfig.json` build output to `src`.
- `npm run check`: passed after adding write-gate coverage; 7 tests passed.
- Claude code/content review: flagged query-param token handling as a major issue.
- `npm run check`: passed after switching token auth out of query parameters, adding
  timeout, date validation, dry-run reason, and read-tool stdio mock coverage; 8 tests
  passed.
- Secret marker scan:
  `rg -n "ghp_|github_pat_|gho_|tskey-|Bearer [A-Za-z0-9._-]{12,}|x-api-token: [A-Za-z0-9._-]{12,}|Authorization:|password|api_key|PIPEDRIVE_API_TOKEN=.*[A-Za-z0-9]{12,}" . --glob '!node_modules/**' --glob '!dist/**'`.
  It returned only documentation references to auth-header patterns, not a token value.
- Post-live-update secret marker scan repeated with `.env`, `.env.*`, `node_modules/`,
  and `dist/` excluded. It returned only the documentation line containing the scan
  pattern in this file, not a token value.
- Pre-push sanity checks:
  - `config.example` contains placeholder values only.
  - `.gitignore` excludes `node_modules/`, `dist/`, `.env`, `.env.*`, and npm debug
    logs.
  - `gh api user --jq .login` returned `pezzos`.
- Public repo creation:
  - `gh repo create pezzos/pipedrive-mcp-lab --public --source=. --remote=origin --push`
    created and pushed <https://github.com/pezzos/pipedrive-mcp-lab>.
  - `gh repo view pezzos/pipedrive-mcp-lab --json name,visibility,url` returned
    `visibility: PUBLIC`.
  - `curl -s -o /dev/null -w '%{http_code}' https://github.com/pezzos/pipedrive-mcp-lab`
    returned `200`.
- Live read-only validation on 2026-05-23:
  - `.env` preflight confirmed `PIPEDRIVE_API_TOKEN` and company/base URL were set, and
    `PIPEDRIVE_ENABLE_WRITES=false`.
  - `npm run check` passed with 8 tests before the live run.
  - A one-off MCP stdio client listed 7 tools and confirmed the expected read/write
    tools were present.
  - `pipedrive_health_check` confirmed token presence, company domain, and base URL
    configured, with `writes_enabled=false`; secret values were not printed.
  - Live `pipedrive_list_pipelines` returned `success: true` and 2 records in the
    sanitized count summary.
  - Live `pipedrive_list_deals` with `status=open` and `limit=1` returned
    `success: true` and 0 records in the sanitized count summary.
  - Live `pipedrive_list_activities` with `limit=1` returned `success: true` and
    `data_type=null`; this is the raw sanitized response shape observed in this run,
    not proof that an activity object was deserialized. The sanitized summary did not
    copy CRM payload data.
  - `pipedrive_create_activity` was called with `dry_run=true` while writes were forced
    off. No real activity write was attempted. Both gates were active simultaneously;
    `dry_run=true` behavior while writes are enabled remains untested.
- Expanded read-only implementation on 2026-05-23:
  - Added read-only tools for global item search, persons list/get, organizations
    list/get, leads list/get, pipeline get, stages list, activities get, activity types,
    current/list users, notes list/get, and deal/person/organization field discovery.
  - Kept `pipedrive_create_activity` as the only write-like tool.
  - `npm run check` passed with 9 tests.
  - A one-off MCP stdio inventory listed 25 tools.
  - Expanded mock MCP coverage asserted endpoint paths, filters, cursor/start
    pagination parameters, token header usage, and no token value in URLs.
- Audit feedback integration on 2026-05-23:
  - Added `PIPEDRIVE_BASE_URL` validation so real configuration must use
    `https://*.pipedrive.com`; local mock servers now require
    `PIPEDRIVE_ALLOW_MOCK_BASE_URL=true` and must be loopback URLs.
  - Added `PIPEDRIVE_WRITE_CONFIRMATION`; real write calls now require writes enabled,
    `dry_run=false`, and a matching confirmation string.
  - Added `PATCH` and `PUT` client methods for update endpoints.
  - Added guarded seller workflow tools for creating/updating deals, persons,
    organizations, leads, notes and activities, moving or closing deals, converting
    leads to deals, marking/rescheduling activities, finding deals, and logging a call
    plus follow-up.
  - Added mocked stdio coverage for every write tool and blocked unlinked lead creation
    before any API call.
  - `npm run check` passed with 11 tests.
  - A one-off MCP stdio inventory listed 44 tools.
  - Secret marker scan returned only the documented scan pattern in this file, not a
    token value.
  - Claude Code review was attempted, but Claude returned a 403 organization-access
    error and no review content was usable.
  - A parallel API-review agent found three material issues: unrestricted mock base URL
    override, unlinked lead creation, and incomplete write-surface tests. All three were
    fixed before this status update.
- Test feedback integration on 2026-05-24:
  - Added default lab-prefix protection for real writes via `PIPEDRIVE_REQUIRE_LAB_PREFIX`
    and `PIPEDRIVE_LAB_PREFIX`; creates require prefixed labels, and updates first read
    existing targets to reject non-lab records.
  - Added `validate_links=true` for write dry-runs so linked deal/person/org/lead/product
    IDs can be checked before any write.
  - Added dry-run redaction for email, phone, notes, comments, content and lost reasons.
  - Deal close tools now accept `YYYY-MM-DD` in addition to ISO datetimes and normalize
    date-only input to midnight UTC.
  - Added tools for products, deal product line items, deal participants, deal followers,
    deal files, and deal mail-message listing.
  - `npm run check` passed with 12 tests.
  - A one-off MCP stdio inventory listed 55 tools.
  - Claude Code review was attempted again, but Claude returned the same 403
    organization-access error and no review content was usable.
- Second live-test feedback integration on 2026-05-24:
  - Added `confirm_lab_write=true` so a test agent can execute lab-prefixed writes
    without receiving the secret confirmation string.
  - Added lab-scoped delete tools for activities, deals, leads, notes, organizations
    and persons. Each delete defaults to dry-run and reads the target first when lab
    prefix protection is enabled.
  - Added `DELETE` support to the Pipedrive client and mocked stdio coverage for delete
    method/path behavior.
  - Added `TEST_PROMPT.md` focused on synthetic live create/update/read/delete cycles
    instead of re-testing already validated read-only discovery.
  - `npm run check` passed with 12 tests.
  - A one-off MCP stdio inventory listed 61 tools.
  - Secret marker scan returned only the documented scan pattern in this file, not a
    token value.
  - Claude Code review was attempted again, but Claude returned the same 403
    organization-access error and no review content was usable.
- Third live-test feedback integration on 2026-05-24:
  - Updated person create/update payloads to send `emails` and `phones` arrays while
    preserving simple `email` and `phone` inputs for users.
  - Updated activity create/update and the call/follow-up workflow to map `person_id`
    into `participants` instead of sending the read-only `person_id` field.
  - Updated lead create/update payloads to keep `organization_id`, require currency
    when a value is supplied, and send value as `{ amount, currency }`.
  - Removed the unreliable v2 organization `address` input from the MCP schema.
  - Replaced `TEST_PROMPT.md` with a focused retest prompt for the remaining mapping
    fixes instead of re-running already validated scenarios.
  - `npm run check` passed with 12 tests.
  - A one-off MCP stdio inventory listed 61 tools.
  - Secret marker scan returned only the documented scan pattern in this file, not a
    token value.
  - Claude Code review was attempted again, but Claude returned the same 403
    organization-access error and no review content was usable.
- Final focused live retest on 2026-05-24:
  - Test session reported `pipedrive_health_check` with writes enabled, lab-prefix
    protection enabled, and lab write confirmation available through
    `confirm_lab_write=true`; `PIPEDRIVE_WRITE_CONFIRMATION` was not used.
  - Run suffix was `MCP LAB - 2026-05-24 - AP-RETEST-1423`.
  - Organization create/update/read/delete passed live without the removed `address`
    field; final read showed `is_deleted=true`.
  - Person create/update/read/delete passed live with email and phone accepted through
    the MCP mappings; final read showed `is_deleted=true`.
  - Activity create/update/mark-done/read/delete passed live with `person_id` mapped
    through participants; final read showed `is_deleted=true`.
  - Lead creation without a person or organization link was rejected as expected. Linked
    lead create/update/read/delete passed live with value and currency; post-delete read
    returned the expected 404.
  - A product line item live write was skipped because `pipedrive_list_products`
    returned zero products in the configured account.
  - No remaining P0/P1/P2 issue was reported by the test session; remaining limits are
    sandbox data and out-of-scope UI areas, not observed MCP mapping failures.
- Reproducible live-lab harness addition on 2026-05-24:
  - Added `src/liveLab.ts` and `npm run live:lab`.
  - The harness requires `PIPEDRIVE_ENABLE_WRITES=true`, active lab-prefix protection,
    a unique `--prefix` starting with `PIPEDRIVE_LAB_PREFIX`, `--confirm-live-lab`, and
    an explicit `--dry-run` or `--no-dry-run` mode.
  - Dry-run mode writes planned JSON/Markdown reports without calling the Pipedrive API.
  - Non-dry-run mode creates, rereads, updates, closes or deletes disposable
    organization/person/lead/deal/note/activity records through the existing endpoint
    surface, then writes redacted reports under `live-lab-reports/` by default.
  - Added mocked harness tests for gate rejection, no-call dry-run reporting, full live
    sequence ordering, token header behavior, and report redaction.
  - `npm run check` passed with 16 tests.
- API mapping documentation on 2026-05-24:
  - Added `docs/API_MAPPING.md` to centralize the live-discovered person, activity,
    lead, organization address, and product line item mapping notes.
  - The doc explicitly keeps product line items and organization address writes out of
    live-validated coverage.
- Prompt and CI maintenance on 2026-05-24:
  - Removed `TEST_PROMPT.md` and split manual validation prompts into four versioned
    files under `prompts/`.
  - Added GitHub Actions CI for install, build/test, whitespace diff checks, a basic
    secret marker scan, and high-severity npm audit.
  - Local validation commands for this change:
    - `npm ci`: passed.
    - `npm run check`: passed with 16 tests.
    - `git diff --check`: passed.
    - basic secret scan using the CI grep patterns: passed.
    - `npm audit --audit-level=high`: passed.

## Final Status

- completion status: live-core-validated-partial-ui
- protocol article impact: draft update possible with an expanded MCP surface, mocked
  commercial write coverage, and real disposable live writes for the core CRM workflow.
- not completed:
  - Fresh real-account execution of the new reproducible `npm run live:lab` harness.
  - Product line item live write, because the configured account had no products.
  - Real pagination and rate-limit header validation.
  - Email send/sync, file upload/download, reports, automations and webhooks.
  - OAuth or remote MCP hosting.
  - Project Pezzos article publication and backlink.
