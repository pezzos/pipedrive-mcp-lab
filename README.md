# Pipedrive MCP Lab

Small local MCP server used for a Project Pezzos article draft about connecting
Claude/Codex to Pipedrive.

Status: public lab, not a production connector. The MCP now exposes a 61-tool surface:
read tools plus a guarded commercial workflow pack. The current evidence proves that the
server starts over stdio, lists the tools, forwards mocked Pipedrive requests without
putting the token in URLs, blocks non-Pipedrive base URLs by default, and keeps every
write behind `PIPEDRIVE_ENABLE_WRITES`, `dry_run`, and either a per-call confirmation
string or lab-only `confirm_lab_write=true`.
A limited read-only live check also ran against a configured account on the earlier core
tools without printing CRM records or enabling writes, but the expanded surface and
write pack are not live-validated unless sandbox or trial status is verified, or
explicit approval is recorded.

## What It Contains

- TypeScript MCP server using `@modelcontextprotocol/sdk`.
- Read-first tools for local health, search, deal finding, deals, persons, organizations, leads,
  pipelines, stages, activities, activity types, users, notes, products, deal products,
  deal participants, deal followers, deal files, deal mail messages, and custom-field
  schema discovery.
- Guarded commercial workflow tools for creating/updating/deleting lab-scoped deals, contacts,
  organizations, leads, notes and activities, moving/closing deals, converting leads,
  marking/rescheduling activities, adding products/participants/followers to deals,
  and logging a call plus a follow-up.
- Friendly input mappings for common Pipedrive API shapes: person `email`/`phone` become
  v2 `emails`/`phones`, activity `person_id` becomes `participants`, and lead values
  become `{ amount, currency }`.
- Tests with mocked HTTP responses and an MCP stdio client.
- `RESULTATS.md` with factual run evidence.
- `TEST_PROMPT.md` with the latest live validation prompt.

## Quick Start

```sh
npm install
npm run check
```

For local manual runs, export variables in your shell:

```sh
export PIPEDRIVE_COMPANY_DOMAIN="your-sandbox-company"
export PIPEDRIVE_API_TOKEN="your-sandbox-token"
export PIPEDRIVE_ENABLE_WRITES="false"
export PIPEDRIVE_WRITE_CONFIRMATION="CONFIRM_WRITE"
export PIPEDRIVE_ALLOW_LAB_WRITE_CONFIRMATION="true"
export PIPEDRIVE_REQUIRE_LAB_PREFIX="true"
export PIPEDRIVE_LAB_PREFIX="MCP LAB -"
npm run build
node dist/server.js
```

Do not use a CRM account containing real customer data for the first live test. Start
with a sandbox or trial account and disposable records.

## Safety Defaults

- No merges, bulk operations, file uploads or downloads, webhooks, admin mutations, or
  other broad CRM writes. Delete tools exist only for lab-scoped cleanup and read the
  target record before deletion.
- Writes are disabled unless `PIPEDRIVE_ENABLE_WRITES=true`.
- Every write tool defaults to `dry_run=true`.
- A real write also requires `confirmation` to match `PIPEDRIVE_WRITE_CONFIRMATION`.
- For lab tests, real writes can use `confirm_lab_write=true` instead of exposing the
  confirmation string, but only while lab-prefix protection is enabled.
- Real writes require lab-scoped records by default: new labels must start with
  `PIPEDRIVE_LAB_PREFIX`, and updates first read the target record and block if its
  label is not lab-prefixed. Set `PIPEDRIVE_REQUIRE_LAB_PREFIX=false` only outside this
  lab protocol.
- Dry-runs redact email, phone, notes, comments, note content and lost reasons in `would_send`.
- Write tools accept `validate_links=true` to read linked deal/person/org/lead/product
  IDs before returning the dry-run response.
- Deal closing tools accept either a full ISO datetime with offset or a `YYYY-MM-DD`
  date, which is normalized to midnight UTC.
- Live smoke for the expanded read/write surface only counts with a verified sandbox or
  trial account, or explicit approval on another account.
- `PIPEDRIVE_BASE_URL` must be `https://*.pipedrive.com` unless
  `PIPEDRIVE_ALLOW_MOCK_BASE_URL=true` is set for loopback mocked tests.
- API token values are sent with the official `x-api-token` header, not query
  parameters, and are not included in thrown error messages.
- `.env` files are ignored by git.

## Not Tested Yet

- Real pagination and rate-limit headers.
- Counted live smoke for the expanded read/write surface on a verified sandbox or trial
  account, or with explicit approval.
- Real write execution against disposable records after the latest lab-confirmation
  changes.
- Email send/sync, file upload/download, reports, automations and webhooks.
- OAuth or remote MCP hosting.

## Related Article

The Project Pezzos article is still a draft, so there is no stable public article URL
yet. Add the backlink here once the article is published.
