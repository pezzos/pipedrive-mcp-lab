# Pipedrive MCP

Model Context Protocol server for Pipedrive CRM operations, delivered either as
a local Claude Desktop Extension or as a remote Cloudflare Worker. It exposes
read tools by default and gates writes, Mailbox, and deletes explicitly.

For client installation in Claude Desktop, start with
[INSTALL.md](INSTALL.md). A French version is available in
[INSTALL.fr.md](INSTALL.fr.md).

## What It Provides

- Read tools for deals, persons, organizations, leads, pipelines, stages,
  activities, notes, products, deal relationships, users, project boards,
  projects, project tasks, and custom field discovery.
- Write tools for creating and updating commercial records when
  `PIPEDRIVE_ENABLE_WRITES=true`.
- Mailbox read tools when `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true`. Linking a
  mail thread additionally requires `PIPEDRIVE_ENABLE_WRITES=true`. Mailbox
  access may require an OAuth access token with the right Pipedrive scopes.
- Delete tools only when both `PIPEDRIVE_ENABLE_WRITES=true` and
  `PIPEDRIVE_ENABLE_DELETE_TOOLS=true`.
- Email activities with `type="email"` linked to a person, deal, organization
  or lead. These are activities, not Mailbox drafts.
- Dry-run support on write tools through `dry_run=true`, which is the default.

The remote Worker performs Pipedrive OAuth login and refresh. The local server
continues to accept an externally supplied token. Mailbox draft creation, email
sending, file upload/download, reports, automations, and webhooks are not
implemented.

## Quick Start

For Claude plugin delivery or local Claude Code pilot testing of the skills,
build the skills plugin artifact:

```sh
npm install
npm run check
npm run pack:claude-plugin
claude plugin validate dist/claude-plugin/pipedrive-mcp
```

See [Claude delivery](docs/CLAUDE_DELIVERY.md). For Cowork, web, mobile, or a
managed client rollout, use the [Cloudflare remote MCP guide](docs/REMOTE_MCP_CLOUDFLARE.md).

For a plain MCP host or repository checkout:

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

This repository is the canonical source for the server, Desktop Extension, and
Claude plugin. Plugin source files live under `plugin/claude/`, the monorepo
marketplace is declared in `.claude-plugin/marketplace.json`, and staged output
lives under `dist/`. The repository plugin contains skills only. Install the
`.mcpb` Desktop Extension for the editable connector
settings UI where users enter `company_domain`, API/OAuth token, write flags,
and timeout. Claude Desktop chat can use the Desktop Extension directly and
does not require a separate Node.js install because Claude Desktop includes an
integrated Node.js runtime for extension MCP servers.

The Desktop Extension now runs directly without copying credentials into
`claude_desktop_config.json`. Versions through `0.1.6` could create a legacy
managed entry there; see [Troubleshooting](docs/TROUBLESHOOTING.md) if an old
duplicate still appears as disconnected. Anthropic's current documentation
says locally configured Desktop MCP servers are not available in Cowork or
`claude.ai`. Version `0.2.0` adds the remote Cloudflare Worker for those
surfaces. Do not install Node.js as a Cowork workaround, and do not rely on a
client-managed `.env` file.

## Runtime Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PIPEDRIVE_COMPANY_DOMAIN` | unset | Company subdomain used to build `https://<company>.pipedrive.com`. Common inputs such as `acme.pipedrive.com` and `https://acme.pipedrive.com/` are normalized. |
| `PIPEDRIVE_BASE_URL` | derived | Optional explicit base URL. Leave empty for normal installs. Common Pipedrive host formats are normalized; the final URL must be `https://*.pipedrive.com` unless mock URLs are enabled. |
| `PIPEDRIVE_API_TOKEN` | unset | Pipedrive API token sent as `x-api-token`. |
| `PIPEDRIVE_ACCESS_TOKEN` | unset | OAuth bearer token. Takes precedence over API token. |
| `PIPEDRIVE_ENABLE_WRITES` | `false` | Registers CRM write tools when `true`. |
| `PIPEDRIVE_ENABLE_MAILBOX_TOOLS` | `false` | Registers Mailbox read tools. Mail linking additionally requires writes. |
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
- Mailbox reads are not registered unless
  `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true`; linking a thread also requires
  `PIPEDRIVE_ENABLE_WRITES=true`.
- Delete tools are not registered unless `PIPEDRIVE_ENABLE_DELETE_TOOLS=true` as well.
- Write tools default to `dry_run=true`.
- Dry-run responses redact common sensitive fields.
- `validate_links=true` reads linked records before sending a write.
- API tokens are sent in headers, not URLs, and token-like values are redacted
  from handled API errors.
- The current extension keeps credentials in its settings and no longer copies
  them into `claude_desktop_config.json`; see [Claude delivery](docs/CLAUDE_DELIVERY.md).

See [Operator Runbook](docs/OPERATOR_RUNBOOK.md), [Client Examples](docs/MCP_CLIENT_EXAMPLES.md),
[Troubleshooting](docs/TROUBLESHOOTING.md), [Remote MCP](docs/REMOTE_MCP_CLOUDFLARE.md),
and [API Mapping Notes](docs/API_MAPPING.md).

Platform statements were checked on 2026-07-15 against Anthropic's
[local MCP server guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), and
[desktop versus web connector guide](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).
