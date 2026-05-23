# Pipedrive MCP Lab

Small local MCP server used for a Project Pezzos article draft about connecting
Claude/Codex to Pipedrive.

Status: public lab, not a production connector. The MCP now exposes a 44-tool surface:
read tools plus a guarded commercial workflow pack. The current evidence proves that the
server starts over stdio, lists the tools, forwards mocked Pipedrive requests without
putting the token in URLs, blocks non-Pipedrive base URLs by default, and keeps every
write behind `PIPEDRIVE_ENABLE_WRITES`, `dry_run`, and a per-call confirmation string.
A limited read-only live check also ran against a configured account on the earlier core
tools without printing CRM records or enabling writes, but the expanded surface and
write pack are not live-validated unless sandbox or trial status is verified, or
explicit approval is recorded.

## What It Contains

- TypeScript MCP server using `@modelcontextprotocol/sdk`.
- Read-first tools for local health, search, deal finding, deals, persons, organizations, leads,
  pipelines, stages, activities, activity types, users, notes, and custom-field schema
  discovery.
- Guarded commercial workflow tools for creating/updating deals, contacts,
  organizations, leads, notes and activities, moving/closing deals, converting leads,
  marking/rescheduling activities, and logging a call plus a follow-up.
- Tests with mocked HTTP responses and an MCP stdio client.
- `RESULTATS.md` with factual run evidence.

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
npm run build
node dist/server.js
```

Do not use a CRM account containing real customer data for the first live test. Start
with a sandbox or trial account and disposable records.

## Safety Defaults

- No deletes, merges, bulk operations, file uploads or downloads, webhooks, admin
  mutations, or other broad CRM writes.
- Writes are disabled unless `PIPEDRIVE_ENABLE_WRITES=true`.
- Every write tool defaults to `dry_run=true`.
- A real write also requires `confirmation` to match `PIPEDRIVE_WRITE_CONFIRMATION`.
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
- Real write execution against disposable records.
- Email send/sync, file upload/download, product line items, participants, followers,
  reports, automations and webhooks.
- OAuth or remote MCP hosting.

## Related Article

The Project Pezzos article is still a draft, so there is no stable public article URL
yet. Add the backlink here once the article is published.
