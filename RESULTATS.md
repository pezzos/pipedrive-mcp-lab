# RESULTATS

## Context

- Lab question: can a small local MCP expose a narrow Pipedrive surface for Claude/Codex
  without making broad CRM writes the default?
- Lab repo state: public GitHub repository.
- Public repo: <https://github.com/pezzos/pipedrive-mcp-lab>
- Current MCP surface: 55 tools, with read tools plus guarded commercial workflow
  writes for common seller actions.
- Real Pipedrive account: read-only validation run on 2026-05-23 with credentials loaded
  from local `.env`.
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
| Mocked commercial write pack | done | `npm run check` passed on 2026-05-24 with 12 tests. The stdio test asserts dry-run does not call the API, wrong confirmation blocks the call, lead creation requires a person or organization link, every write tool sends the expected `POST`/`PATCH`/`PUT` request to the mock when confirmed, and token values stay in the `x-api-token` header rather than URLs. |
| Lab-prefix write guard and dry-run link validation | done | `npm run check` passed on 2026-05-24 with 12 tests. Real writes require lab-prefixed create labels or a lab-prefixed existing target, dry-runs can use `validate_links=true` to read linked records, and dry-run payloads redact email, phone, notes, comments, content and lost reasons. |
| Base URL allowlist | done | Config tests reject non-Pipedrive base URLs. `PIPEDRIVE_ALLOW_MOCK_BASE_URL=true` only permits loopback mock URLs, not arbitrary hosts. |
| MCP stdio tools/list for the expanded surface | done | A one-off inventory listed 55 tools after implementation; the test suite asserts the added tools are present and read-only where applicable. |
| Live smoke for the expanded read/write surface on a verified sandbox or trial account, or with explicit approval | not-run | This is the acceptance bar for counting the expansion as live-validated. The current configured-account read does not satisfy it on its own. |
| Live pagination and rate-limit headers across the expanded read-only surface | not-run | Still pending. |
| Real write execution against disposable CRM records | not-run | Requires sandbox or trial verification, or explicit approval on the configured account. |
| Public repo secret scan | done | Local pre-publish `rg` scan passed on 2026-05-23; GitHub secret scanning is expected to run after public push. |
| Public GitHub repo creation | done | `pezzos/pipedrive-mcp-lab` was created public and pushed on 2026-05-23. |

## Current Allowed Conclusion

The current lab may support this conclusion after tests pass: the local MCP server is
structurally runnable over stdio, exposes an expanded 55-tool read/write lab surface,
keeps real writes behind explicit gates, can be tested without real CRM data, and can
perform basic read-only calls against a configured Pipedrive account for the earlier core
tools.

It must not support this conclusion yet: the expanded surface is live-validated, the MCP
is production-ready, it is safe to use on customer CRM data without a separate
permission model, or it is validated for real writes, pagination, rate limits, OAuth, or
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

## Final Status

- completion status: partial
- protocol article impact: draft update possible with an expanded MCP surface and mocked
  commercial write workflows, but not production or live write evidence.
- not completed:
  - Counted live smoke for the expanded read/write surface on a verified sandbox or trial
    account, or with explicit approval.
  - Real disposable writes for deals, contacts, leads, notes, activities, product line
    items, participants and followers.
  - Real pagination and rate-limit header validation.
  - Email send/sync, file upload/download, reports, automations and webhooks.
  - OAuth or remote MCP hosting.
  - Project Pezzos article publication and backlink.
