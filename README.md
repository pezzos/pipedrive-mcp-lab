# Pipedrive MCP Lab

Small local MCP server used for a Project Pezzos article draft about connecting
Claude/Codex to Pipedrive.

Status: public lab, not a production connector. The MCP now exposes an 88-tool surface:
read tools plus a guarded commercial workflow pack. The current evidence proves that the
server starts over stdio, lists the tools, forwards mocked Pipedrive requests without
putting the token in URLs, blocks non-Pipedrive base URLs by default, and keeps every
write behind `PIPEDRIVE_ENABLE_WRITES`, `dry_run`, and either a per-call confirmation
string or lab-only `confirm_lab_write=true`.
Live validation also ran against a configured account with explicit approval:
lab-prefixed disposable records were created, updated, reread, and deleted for the core
CRM workflow without printing CRM payloads or sharing the write-confirmation secret with
the test session. Product line items remain untested because the configured account had
no products.

## What It Contains

- TypeScript MCP server using `@modelcontextprotocol/sdk`.
- Read-first tools for local health, search, deal finding, deals, persons, organizations, leads,
  pipelines, stages, activities, activity types, users, notes, products, deal products,
  deal participants, deal followers, deal files, deal mail messages, Pipedrive Mailbox
  threads/messages, project boards, project phases, project templates, project fields,
  projects, project tasks, and custom-field schema discovery.
- Guarded commercial workflow tools for creating/updating/deleting lab-scoped deals, contacts,
  organizations, leads, notes and activities, moving/closing deals, converting leads,
  marking/rescheduling activities, adding products/participants/followers to deals,
  linking a Mailbox thread to one deal or lead, logging a call plus a follow-up, and
  creating/updating/archiving/deleting lab-scoped projects and project tasks.
- Friendly input mappings for common Pipedrive API shapes: person `email`/`phone` become
  v2 `emails`/`phones`, activity `person_id` becomes `participants`, and lead values
  become `{ amount, currency }`, and task `done`/`milestone` map to the beta Tasks API's
  effective `is_done`/`is_milestone` write fields. Project and task endpoints are beta;
  the first project write slice deliberately excludes `template_id`, project `status`,
  `health_status`, v1 project-plan moves, and task `assignee_ids`. See
  [API mapping notes](docs/API_MAPPING.md) for the live evidence and known gaps.
- Tests with mocked HTTP responses and an MCP stdio client.
- Reproducible live-lab harness: `npm run live:lab -- --prefix "..."`.
- `RESULTATS.md` with factual run evidence.
- Versioned live validation prompts under `prompts/`.

## Quick Start

```sh
npm install
npm run check
```

For local manual runs, export variables in your shell:

```sh
export PIPEDRIVE_COMPANY_DOMAIN="your-sandbox-company"
export PIPEDRIVE_API_TOKEN="your-sandbox-token"
# Optional OAuth alternative for endpoints that require scoped access, such as Mailbox.
# export PIPEDRIVE_ACCESS_TOKEN="your-oauth-access-token"
export PIPEDRIVE_ENABLE_WRITES="false"
export PIPEDRIVE_WRITE_CONFIRMATION="CONFIRM_WRITE"
export PIPEDRIVE_REQUIRE_WRITE_CONFIRMATION="true"
export PIPEDRIVE_ALLOW_LAB_WRITE_CONFIRMATION="true"
export PIPEDRIVE_REQUIRE_LAB_PREFIX="true"
export PIPEDRIVE_LAB_PREFIX="MCP LAB -"
npm run build
node dist/server.js
```

Do not use a CRM account containing real customer data for the first live test. Start
with a sandbox or trial account and disposable records.

## Reproducible Live Lab Harness

The live harness creates a disposable organization, person, lead, deal, note and
activity, rereads them, updates them, marks the activity done, closes the deal as lost,
then deletes the disposable records. It also discovers the first project board and
phase; when both exist, it creates, rereads, updates, marks done, and deletes one
disposable project plus one disposable project task. If no board or phase exists, that
project/task subtest is reported as skipped. It writes redacted JSON and Markdown reports
under `live-lab-reports/` by default.

Dry-run, with no Pipedrive API calls:

```sh
PIPEDRIVE_ENABLE_WRITES=true npm run live:lab -- \
  --prefix "MCP LAB - 2026-05-24 - YOUR-RUN-ID" \
  --dry-run \
  --confirm-live-lab
```

Real disposable run:

```sh
PIPEDRIVE_ENABLE_WRITES=true npm run live:lab -- \
  --prefix "MCP LAB - 2026-05-24 - YOUR-RUN-ID" \
  --no-dry-run \
  --confirm-live-lab
```

The harness refuses to start unless all of these are true:

- `PIPEDRIVE_ENABLE_WRITES=true`.
- `PIPEDRIVE_REQUIRE_LAB_PREFIX` is not disabled.
- `--prefix` starts with `PIPEDRIVE_LAB_PREFIX` and includes a unique suffix.
- `--confirm-live-lab` is present.
- The run mode is documented with either `--dry-run` or `--no-dry-run`.

Generated reports redact email, phone, note content and lost reasons, and never include
the API token.

## Safety Defaults

- No merges, bulk operations, file uploads or downloads, webhooks, admin mutations, or
  other broad CRM writes. Delete tools exist only for lab-scoped cleanup and read the
  target record before deletion.
- Writes are disabled unless `PIPEDRIVE_ENABLE_WRITES=true`.
- Every write tool defaults to `dry_run=true`.
- By default, a real write also requires `confirmation` to match
  `PIPEDRIVE_WRITE_CONFIRMATION`.
- For production MCP operation, set `PIPEDRIVE_REQUIRE_WRITE_CONFIRMATION=false` so
  approved tool calls can write without sharing the confirmation string.
- For lab tests, real writes can use `confirm_lab_write=true` instead of exposing the
  confirmation string, but only while lab-prefix protection is enabled.
- Real writes require lab-scoped records by default: new labels must start with
  `PIPEDRIVE_LAB_PREFIX`, and updates first read the target record and block if its
  label is not lab-prefixed. Set `PIPEDRIVE_REQUIRE_LAB_PREFIX=false` only outside this
  lab protocol.
- Dry-runs redact email, phone, notes, comments, note content, lost reasons and
  Mailbox-sensitive fields such as message bodies, snippets, subjects and recipients in
  `would_send`.
- Write tools accept `validate_links=true` to read linked deal/person/org/lead/product
  IDs before returning the dry-run response. Project tools also validate linked board,
  phase, deal, person and organization IDs; task tools validate linked project IDs.
- Mailbox read tools can return sensitive email metadata or bodies. Use
  `pipedrive_mailbox_probe` first to verify access without returning subjects,
  addresses or body content. `pipedrive_get_mail_message` defaults to
  `include_body=false`.
- Mailbox thread linking is intentionally limited to deal/lead association. It does not
  expose sharing, read/unread, archive or delete flags.
- Project and task real writes are lab-scoped by their own `title`; a lab-prefixed
  project does not authorize non-lab task titles.
- Deal closing tools accept either a full ISO datetime with offset or a `YYYY-MM-DD`
  date, which is normalized to midnight UTC.
- Live smoke for the expanded read/write surface only counts with a verified sandbox or
  trial account, or explicit approval on another account.
- `PIPEDRIVE_BASE_URL` must be `https://*.pipedrive.com` unless
  `PIPEDRIVE_ALLOW_MOCK_BASE_URL=true` is set for loopback mocked tests.
- API token values are sent with the official `x-api-token` header, not query
  parameters, and are not included in thrown error messages.
- Runtime configuration can be supplied by the MCP host environment, by
  `pipedrive-mcp-lab/.env`, or by the parent repository `.env`. Existing host
  environment values win, then the local MCP `.env`, then the parent `.env`.
  Set `PIPEDRIVE_LOAD_DOTENV=false` to disable dotenv loading in controlled
  harnesses.
- `pipedrive_health_check` reports non-sensitive runtime-env diagnostics for the
  write gate variables, including which keys existed before dotenv loading and
  which keys exist after loading. If `runtime_env_preexisting_*` is true, the
  process already had that key before `.env` was loaded, so `.env` values will
  not override it. `dotenv_loading_enabled=true` with
  `runtime_env_preexisting_load_dotenv=false` means dotenv loading is active by
  default rather than explicitly configured.
- `.env` files are ignored by git.

## Not Tested Yet

- Real pagination and rate-limit headers.
- Product line item live write, because the configured account had no products.
- Project template-based project creation, project status/health status writes, v1
  project-plan moves, and task `assignee_ids`.
- Full API mapping coverage. Current mapping notes are in
  [docs/API_MAPPING.md](docs/API_MAPPING.md).
- Creating Pipedrive email drafts, sending email, replying to email, file
  upload/download, reports, automations and webhooks.
- OAuth refresh flows or remote MCP hosting. `PIPEDRIVE_ACCESS_TOKEN` is accepted when
  supplied, but this lab does not obtain or refresh OAuth tokens.

## Live Validation Prompts

Use the versioned prompts under `prompts/` when running manual MCP validation:

- [full-live-validation](prompts/full-live-validation.md): broad disposable live workflow.
- [focused-retest-mappings](prompts/focused-retest-mappings.md): targeted mapping retest.
- [product-line-item-retest](prompts/product-line-item-retest.md): product line item path, only when a product exists.
- [read-only-smoke](prompts/read-only-smoke.md): safe read-only API smoke.

## Related Article

The Project Pezzos article is still a draft, so there is no stable public article URL
yet. Add the backlink here once the article is published.
