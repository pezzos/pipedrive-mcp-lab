# RESULTATS

## Context

- Lab question: can a small local MCP expose a narrow Pipedrive surface for Claude/Codex
  without making broad CRM writes the default?
- Lab repo state: public GitHub repository.
- Public repo: <https://github.com/pezzos/pipedrive-mcp-lab>
- Real Pipedrive account: not used.
- CRM data: no real CRM data used.

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
| MCP stdio tools/list and dry-run call | done | `npm run check` passed on 2026-05-23. |
| Write-gate behavior without token | done | Dry-run succeeds without a token; non-dry-run with writes enabled returns a clear `PIPEDRIVE_API_TOKEN` error. |
| Read-tool MCP call against mocked HTTP API | done | `pipedrive_list_deals` calls a local mock server over stdio and sends token via `x-api-token` header, not URL query. |
| Live Pipedrive sandbox read | not-run | No sandbox/trial token supplied. |
| Live dry-run-to-real activity creation | not-run | Requires disposable CRM record and explicit approval. |
| Public repo secret scan | done | Local pre-publish `rg` scan passed on 2026-05-23; GitHub secret scanning is expected to run after public push. |
| Public GitHub repo creation | done | `pezzos/pipedrive-mcp-lab` was created public and pushed on 2026-05-23. |

## Current Allowed Conclusion

The current lab may support only this conclusion after tests pass: the local MCP server
is structurally runnable over stdio, exposes a narrow read-first tool list, keeps the
write path gated, and can be tested without real CRM data.

It must not support this conclusion yet: the MCP works against a real Pipedrive account
or is ready to use on customer CRM data.

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

## Final Status

- completion status: partial
- protocol article impact: draft update possible, but only as mocked/local structural
  evidence.
- not completed:
  - Live Pipedrive sandbox/trial read.
  - Real disposable `create_activity` write.
  - Project Pezzos article publication and backlink.
