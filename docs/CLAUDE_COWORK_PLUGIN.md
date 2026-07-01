# Claude Cowork Plugin

This package can be staged as a Claude plugin for Claude Cowork and Claude Code.
The repository plugin contains Pipedrive-specific Cowork skills only. Install
the Pipedrive MCP Desktop Extension (`.mcpb`) for the editable connector
settings.

The Desktop Extension is the credential entry point. After the user saves a
company domain and API/OAuth token in extension settings, the extension writes a
managed `pipedrive` MCP server entry to Claude Desktop's
`claude_desktop_config.json`. Cowork can then discover the local `pipedrive_*`
tools through the same Desktop MCP path. Users do not need to edit `.env` files
or JSON config by hand.

## Build The Plugin

```sh
npm install
npm run check
npm run pack:claude-plugin
claude plugin validate dist/claude-plugin/pipedrive-mcp
```

The staged plugin lives at:

```text
dist/claude-plugin/pipedrive-mcp/
```

The staged plugin artifact contains the Claude plugin manifest, skills, README,
LICENSE, and this guide. It must not contain `.mcp.json`, `dist/`, `src/`,
`tests/`, `node_modules/`, `.env`, tarballs, or package lock files.

## Install For Pilot Testing

For local Claude Code pilot testing:

```sh
claude --plugin-dir dist/claude-plugin/pipedrive-mcp
```

For routine client delivery, use a private Git plugin repository or private
Claude plugin marketplace. Do not use a side-loaded zip as the primary support
path.

## Configure The Connector

Configure credentials in the Desktop Extension settings, not in the Cowork
plugin Connectors tab and not in a `.env` file. Required fields:

- Pipedrive company domain: enter only the company subdomain used for
  `https://<company>.pipedrive.com`.
- Pipedrive API token, or OAuth access token where required.

Optional fields:

- Explicit base URL, only when the company domain is not enough.
- Write, Mailbox, and delete flags.
- Request timeout.

The Cowork plugin's Connectors screen is read-only when a repository plugin
declares a connector. For client delivery, the repository plugin therefore does
not declare a connector. The `.mcpb` extension owns the editable configuration
form for the local MCP server and synchronizes a managed Desktop MCP entry from
those values.

The managed Desktop MCP entry contains the token as environment configuration
for the local MCP server. Treat Claude Desktop configuration and extension
storage as sensitive local files and include token rotation in offboarding. The
extension writes the managed Desktop MCP config file with owner-only permissions
where the operating system supports POSIX file modes.

## Safety Defaults

- The plugin is disabled by default after installation.
- The repository plugin contains no credentials, `.mcp.json`, or bundled server.
- The skills require `pipedrive_*` tools and instruct Claude not to use the
  official Pipedrive connector.
- CRM write tools are not registered unless writes are enabled.
- Mailbox tools require both writes and the Mailbox flag.
- Delete tools require both writes and the delete flag.
- Write tools default to `dry_run=true`.
- Mailbox draft creation and email sending are not supported.
- OAuth login and token refresh are not implemented.

## Cowork Requirements

Before client rollout, confirm:

- Custom plugins are allowed by the workspace or organization.
- The user can install and trust the plugin.
- The user can install the `.mcpb` Desktop Extension and edit extension
  settings.
- The client accepts the credential storage behavior for extension settings.
- Users can restart Claude Desktop, or at least start a new Cowork task, after
  saving extension settings so Cowork sees the synchronized MCP server.

If the Pipedrive MCP tools are unavailable, first check that the `.mcpb`
extension is installed, enabled, and configured. Then check that Claude Desktop
has a managed `mcpServers.pipedrive` entry. Do not fall back to the official
Pipedrive connector.

## Update And Uninstall

For a private plugin repository, update by publishing a new plugin version and
having users update or reinstall the plugin according to the marketplace
workflow.

When uninstalling, remove the plugin and the Desktop Extension, delete the
managed `mcpServers.pipedrive` entry if it remains, then revoke or rotate
Pipedrive tokens that were configured for it.
