# Pipedrive MCP Lab

Small local MCP server used for a Project Pezzos article draft about connecting
Claude/Codex to Pipedrive.

Status: public lab, not a production connector. The current evidence proves that the MCP
server starts over stdio, lists tools, runs mocked Pipedrive client tests, and keeps the
first write tool behind `PIPEDRIVE_ENABLE_WRITES` with `dry_run` enabled by default. A
read-only live validation against a configured Pipedrive account also succeeded on
pipelines, deals, and activities without printing CRM records or enabling writes.

## What It Contains

- TypeScript MCP server using `@modelcontextprotocol/sdk`.
- Read-first tools for deals, persons, pipelines, activities and local health.
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

- No deletes, merges, bulk operations, file uploads, webhooks, or custom-field writes.
- Writes are disabled unless `PIPEDRIVE_ENABLE_WRITES=true`.
- `pipedrive_create_activity` defaults to `dry_run=true`.
- API token values are sent with the official `x-api-token` header, not query
  parameters, and are not included in thrown error messages.
- `.env` files are ignored by git.

## Not Tested Yet

- Real pagination and rate-limit headers.
- Real activity creation against a disposable record.
- OAuth or remote MCP hosting.

## Related Article

The Project Pezzos article is still a draft, so there is no stable public article URL
yet. Add the backlink here once the article is published.
