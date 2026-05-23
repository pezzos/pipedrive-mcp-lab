# RESULTATS

## Context

- Lab question: can a small local MCP expose a narrow Pipedrive surface for Claude/Codex
  without making broad CRM writes the default?
- Lab repo state: public GitHub repository.
- Public repo: <https://github.com/pezzos/pipedrive-mcp-lab>
- Current MCP surface: 25 tools, with 24 read-only tools and one guarded activity write.
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
| Write-gate behavior without token | done | Dry-run succeeds without a token; non-dry-run with writes enabled returns a clear `PIPEDRIVE_API_TOKEN` error. |
| Read-tool MCP call against mocked HTTP API | done | `pipedrive_list_deals` calls a local mock server over stdio and sends token via `x-api-token` header, not URL query. |
| Limited live Pipedrive read on configured account | done | On 2026-05-23, an MCP stdio client called live `pipedrive_list_pipelines`, `pipedrive_list_deals`, and `pipedrive_list_activities` with writes forced off. All returned `success: true`; the captured output recorded only counts and success flags. This is informational evidence, not counted sign-off for the expanded read-only surface because sandbox or trial status was not independently verified. The activities tool later moved from the earlier v1 path to `/api/v2/activities`, so the previous live activities result covers the old endpoint path, not the new v2 response shape. |
| Mocked coverage for `search_items`, persons list/get, organizations list/get, stages list, leads list/get, activity types list, users current/list, notes list/get, and deal/person/organization field discovery | done | `npm run check` passed on 2026-05-23 with 9 tests. The expanded MCP stdio test called each added read-only tool against a local mock API and asserted endpoint paths, filters, pagination parameters, `x-api-token` header usage, and absence of token values in URLs. |
| MCP stdio tools/list for the expanded read-only surface | done | A one-off inventory listed 25 tools after implementation; the test suite asserts the added tools are present and read-only where applicable. |
| Live smoke for the expanded read-only surface on a verified sandbox or trial account, or with explicit approval | not-run | This is the acceptance bar for counting the expansion as live-validated. The current configured-account read does not satisfy it on its own. |
| Live pagination and rate-limit headers across the expanded read-only surface | not-run | Still pending. |
| Live dry-run-to-real activity creation | not-run | Requires disposable CRM record and explicit approval. |
| Public repo secret scan | done | Local pre-publish `rg` scan passed on 2026-05-23; GitHub secret scanning is expected to run after public push. |
| Public GitHub repo creation | done | `pezzos/pipedrive-mcp-lab` was created public and pushed on 2026-05-23. |

## Current Allowed Conclusion

The current lab may support this conclusion after tests pass: the local MCP server is
structurally runnable over stdio, exposes an expanded 25-tool read-first surface, keeps
the write path gated, can be tested without real CRM data, and can perform basic
read-only calls against a configured Pipedrive account for the earlier core tools.

It must not support this conclusion yet: the expanded read-only surface is
live-validated, the MCP is production-ready, it is safe to use on customer CRM data, or
it is validated for real writes, pagination, rate limits, OAuth, or remote hosting.

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

## Final Status

- completion status: partial
- protocol article impact: draft update possible with an expanded read-only MCP surface,
  but not production or write evidence.
- not completed:
  - Counted live smoke for the expanded read-only surface on a verified sandbox or trial
    account, or with explicit approval.
  - Real disposable `create_activity` write.
  - Real pagination and rate-limit header validation.
  - OAuth or remote MCP hosting.
  - Project Pezzos article publication and backlink.
