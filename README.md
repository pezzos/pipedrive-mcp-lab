# Pipedrive MCP Lab

Small local MCP server used for a Project Pezzos article draft about connecting
Claude/Codex to Pipedrive.

Status: public lab, not a production connector. The MCP now exposes a 25-tool surface:
24 read-only tools plus one guarded activity write. The current evidence proves that the
server starts over stdio, lists the expanded tools, forwards mocked Pipedrive requests
without putting the token in URLs, and keeps the only write path behind
`PIPEDRIVE_ENABLE_WRITES` with `dry_run` enabled by default. A limited read-only live
check also ran against a configured account on the earlier core tools without printing
CRM records or enabling writes, but the expanded surface is not live-validated unless
sandbox or trial status is verified, or explicit approval is recorded.

## What It Contains

- TypeScript MCP server using `@modelcontextprotocol/sdk`.
- Read-first tools for local health, search, deals, persons, organizations, leads,
  pipelines, stages, activities, activity types, users, notes, and custom-field schema
  discovery.
- One guarded write tool: `pipedrive_create_activity`.
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
npm run build
node dist/server.js
```

Do not use a CRM account containing real customer data for the first live test. Start
with a sandbox or trial account and disposable records.

## Safety Defaults

- No deletes, merges, bulk operations, file uploads or downloads, webhooks, admin
  mutations, or other broad CRM writes.
- Writes are disabled unless `PIPEDRIVE_ENABLE_WRITES=true`.
- `pipedrive_create_activity` defaults to `dry_run=true`.
- Live smoke for the expanded read-only surface only counts with a verified sandbox or
  trial account, or explicit approval on another account.
- API token values are sent with the official `x-api-token` header, not query
  parameters, and are not included in thrown error messages.
- `.env` files are ignored by git.

## Not Tested Yet

- Real pagination and rate-limit headers.
- Real activity creation against a disposable record.
- Counted live smoke for that expanded surface on a verified sandbox or trial account,
  or with explicit approval.
- OAuth or remote MCP hosting.

## Related Article

The Project Pezzos article is still a draft, so there is no stable public article URL
yet. Add the backlink here once the article is published.
