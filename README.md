# Pipedrive MCP

Local Model Context Protocol server for Pipedrive CRM operations. It exposes
read tools by default and can expose write, Mailbox, and delete tools through
explicit environment flags.

## What It Provides

- Read tools for deals, persons, organizations, leads, pipelines, stages,
  activities, notes, products, deal relationships, users, project boards,
  projects, project tasks, and custom field discovery.
- Write tools for creating and updating commercial records when
  `PIPEDRIVE_ENABLE_WRITES=true`.
- Mailbox read/link tools only when both `PIPEDRIVE_ENABLE_WRITES=true` and
  `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true`. Mailbox access may require an OAuth
  access token with the right Pipedrive scopes.
- Delete tools only when both `PIPEDRIVE_ENABLE_WRITES=true` and
  `PIPEDRIVE_ENABLE_DELETE_TOOLS=true`.
- Dry-run support on write tools through `dry_run=true`, which is the default.

Draft creation, email sending, OAuth refresh, file upload/download, reports,
automations, webhooks, and remote hosting are not implemented in this version.

## Quick Start

```sh
npm install
cp config.example .env
# edit .env
npm run check
node dist/server.js
```

Minimal environment:

```sh
PIPEDRIVE_COMPANY_DOMAIN=your-company
PIPEDRIVE_API_TOKEN=your-api-token
PIPEDRIVE_ENABLE_WRITES=false
PIPEDRIVE_ENABLE_MAILBOX_TOOLS=false
PIPEDRIVE_ENABLE_DELETE_TOOLS=false
```

OAuth can be supplied instead of an API token:

```sh
PIPEDRIVE_ACCESS_TOKEN=your-oauth-access-token
```

`PIPEDRIVE_ACCESS_TOKEN` takes precedence over `PIPEDRIVE_API_TOKEN` when both
are configured.

## MCP Host Configuration

Build the server first, then configure the MCP host to run either
`node dist/server.js` from this repository or the packaged `pipedrive-mcp` bin.
Claude Desktop examples are below; additional profiles are in
[MCP client examples](docs/MCP_CLIENT_EXAMPLES.md).

## Runtime Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PIPEDRIVE_COMPANY_DOMAIN` | unset | Company subdomain used to build `https://<company>.pipedrive.com`. |
| `PIPEDRIVE_BASE_URL` | derived | Optional explicit base URL. Must be `https://*.pipedrive.com` unless mock URLs are enabled. |
| `PIPEDRIVE_API_TOKEN` | unset | Pipedrive API token sent as `x-api-token`. |
| `PIPEDRIVE_ACCESS_TOKEN` | unset | OAuth bearer token. Takes precedence over API token. |
| `PIPEDRIVE_ENABLE_WRITES` | `false` | Registers CRM write tools when `true`. |
| `PIPEDRIVE_ENABLE_MAILBOX_TOOLS` | `false` | Registers Mailbox tools when writes are also enabled. |
| `PIPEDRIVE_ENABLE_DELETE_TOOLS` | `false` | Registers delete tools when writes are also enabled. |
| `PIPEDRIVE_LOAD_DOTENV` | `true` | Loads local `.env`; set `false` for controlled host environments. |
| `PIPEDRIVE_REQUEST_TIMEOUT_MS` | `10000` | Fetch timeout for Pipedrive API calls. |
| `PIPEDRIVE_ALLOW_MOCK_BASE_URL` | `false` | Allows loopback base URLs for mocked tests only. |

Only the local `.env` next to this package is loaded. Parent directory `.env`
files are ignored.

## Claude Desktop

On macOS, add the server under `mcpServers` in:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Repository checkout example:

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "node",
      "args": ["/absolute/path/to/pipedrive-mcp/dist/server.js"],
      "env": {
        "PIPEDRIVE_ENABLE_WRITES": "false",
        "PIPEDRIVE_ENABLE_MAILBOX_TOOLS": "false",
        "PIPEDRIVE_ENABLE_DELETE_TOOLS": "false",
        "PIPEDRIVE_LOAD_DOTENV": "true"
      }
    }
  }
}
```

Packaged install example:

```json
{
  "mcpServers": {
    "pipedrive": {
      "command": "pipedrive-mcp",
      "args": [],
      "env": {
        "PIPEDRIVE_COMPANY_DOMAIN": "your-company",
        "PIPEDRIVE_API_TOKEN": "your-api-token",
        "PIPEDRIVE_ENABLE_WRITES": "false",
        "PIPEDRIVE_ENABLE_MAILBOX_TOOLS": "false",
        "PIPEDRIVE_ENABLE_DELETE_TOOLS": "false",
        "PIPEDRIVE_LOAD_DOTENV": "false"
      }
    }
  }
}
```

Restart Claude Desktop after editing the file.

## Safety Defaults

- CRM write tools are not registered unless `PIPEDRIVE_ENABLE_WRITES=true`.
- Mailbox tools are not registered unless `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true` as well.
- Delete tools are not registered unless `PIPEDRIVE_ENABLE_DELETE_TOOLS=true` as well.
- Write tools default to `dry_run=true`.
- Dry-run responses redact common sensitive fields.
- `validate_links=true` reads linked records before sending a write.
- API tokens are sent in headers, not URLs, and token-like values are redacted
  from handled API errors.

See [Operator Runbook](docs/OPERATOR_RUNBOOK.md), [Client Examples](docs/MCP_CLIENT_EXAMPLES.md),
[Troubleshooting](docs/TROUBLESHOOTING.md), and [API Mapping Notes](docs/API_MAPPING.md).
