# Claude Plugin, Desktop Extension, And Remote Delivery

This package stages a Claude skills plugin and a Pipedrive MCP Desktop
Extension, and builds a Cloudflare Worker for remote MCP delivery. The plugin
contains Pipedrive-specific skills only; the `.mcpb` provides local settings,
while the remote Worker provides Access login and per-user settings.

Claude Desktop chat is the supported local validation path. The Desktop
Extension uses Claude Desktop's integrated Node.js runtime, so users do not need
to install Node.js or edit `.env` or JSON files.

The current Desktop Extension runs directly and does not copy credentials into
`claude_desktop_config.json`. Versions through `0.1.6` could create a legacy
managed entry in that file. It is not used by the current extension and never
provided a supported or reliable Cowork path. Earlier guidance overstated that
bridge's role; Anthropic's current documentation says local Desktop-configured
MCP servers are not available in Cowork or `claude.ai`, so a remote MCP
connector is required for those surfaces. Version `0.2.0` implements that path
with Cloudflare Access Managed OAuth.

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

Configure credentials in the Desktop Extension settings, not in a plugin
Connectors tab and not in a `.env` file. Required fields:

- Pipedrive company domain: enter only the company subdomain used for
  `https://<company>.pipedrive.com`.
- Pipedrive API token, or OAuth access token where required.

Optional fields:

- Explicit base URL, only when the company domain is not enough.
- Write, Mailbox, and delete flags.
- Request timeout.

The repository plugin intentionally declares no connector. The `.mcpb`
extension owns the editable configuration form and the supported local server.

Treat Claude Desktop extension storage as sensitive local data and include
token rotation in offboarding. An installation upgraded from version `0.1.6`
or earlier may also retain a legacy managed entry with credentials in
`claude_desktop_config.json`; follow the troubleshooting guide to identify it.

## Safety Defaults

- The plugin is disabled by default after installation.
- The repository plugin contains no credentials, `.mcp.json`, or bundled server.
- The skills require `pipedrive_*` tools and instruct Claude not to use the
  official Pipedrive connector, whose different tools do not share this
  package's safety defaults.
- CRM write tools are not registered unless writes are enabled.
- Mailbox reads require the Mailbox flag; mail linking also requires writes.
- Delete tools require both writes and the delete flag.
- Write tools default to `dry_run=true`.
- Mailbox draft creation and email sending are not supported.
- The local extension accepts supplied credentials. The remote Worker performs
  admin-owned Pipedrive OAuth login and refreshes the encrypted tenant grant.

## Supported Surfaces

Before client rollout, confirm:

- Custom plugins are allowed by the workspace or organization.
- The user can install and trust the plugin.
- The user can install the `.mcpb` Desktop Extension and edit extension
  settings.
- The client accepts the credential storage behavior for extension settings.
- Users can restart Claude Desktop after installing or updating the extension.

If the Pipedrive MCP tools are unavailable, first check that the `.mcpb`
extension is installed, enabled, and configured, then inspect its status and
logs in Claude Desktop. Do not install Node.js as a workaround.

The local connector is supported in Claude Desktop. The repository skills can
also be pilot-tested in Claude Code with `claude --plugin-dir`, but that command
does not install the local connector there. Cowork, web, and mobile use the
separately deployed remote MCP connector. Users complete Cloudflare Access
login, start read-only, and manage only their own permissions at `/settings`.
See [Remote MCP On Cloudflare](REMOTE_MCP_CLOUDFLARE.md).

## Update And Uninstall

For a private plugin repository, update by publishing a new plugin version and
having users update or reinstall the plugin according to the marketplace
workflow.

When uninstalling, remove the plugin and the Desktop Extension. If an older
installation left a marked managed entry in `claude_desktop_config.json`,
review and remove it manually; the uninstaller does not delete client
configuration. Then revoke or rotate Pipedrive tokens that were configured for
it.

Platform statements were checked on 2026-07-15 against Anthropic's
[local MCP server guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), and
[desktop versus web connector guide](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).
