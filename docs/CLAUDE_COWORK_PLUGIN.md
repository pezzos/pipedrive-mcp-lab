# Claude Cowork Plugin

This package can be staged as a Claude plugin for Claude Cowork and Claude Code.
The plugin bundles the Pipedrive MCP server and Pipedrive-specific skills. It
does not require `npm install` at runtime because the MCP server is bundled into
`dist/plugin-server.js`.

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

The staged artifact contains the Claude plugin manifest, MCP config, skills,
the bundled server, README, LICENSE, and this guide. It must not contain
`src/`, `tests/`, `node_modules/`, `.env`, tarballs, or package lock files.

## Install For Pilot Testing

For local Claude Code pilot testing:

```sh
claude --plugin-dir dist/claude-plugin/pipedrive-mcp
```

For routine client delivery, use a private Git plugin repository or private
Claude plugin marketplace. Do not use a side-loaded zip as the primary support
path.

## Configure Credentials

The plugin uses `userConfig` and maps values into the MCP process environment.
Configure:

- Pipedrive company domain, or explicit base URL.
- `api_token` or `access_token`.
- Optional write, Mailbox, and delete flags.
- Request timeout.

The plugin forces `PIPEDRIVE_LOAD_DOTENV=false`. Do not place credentials in a
plugin `.env` file.

Sensitive values are expected to use Claude's secure storage path where
available. On hosts where keychain integration is unavailable, Claude may fall
back to credentials stored under `~/.claude/`. Treat that path as sensitive and
include token rotation in offboarding.

## Safety Defaults

- The plugin is disabled by default after installation.
- CRM write tools are not registered unless writes are enabled.
- Mailbox tools require both writes and the Mailbox flag.
- Delete tools require both writes and the delete flag.
- Write tools default to `dry_run=true`.
- Mailbox draft creation and email sending are not supported.
- OAuth login and token refresh are not implemented.

## Cowork Requirements

Before client rollout, confirm:

- Custom plugins are allowed by the workspace or organization.
- Local MCP servers are allowed.
- The user can install and trust the plugin.
- The client accepts the credential storage behavior for sensitive user config.

If any of these are blocked by admin policy, use the standard MCP host
configuration path documented in `docs/MCP_CLIENT_EXAMPLES.md`.

## Update And Uninstall

For a private plugin repository, update by publishing a new plugin version and
having users update or reinstall the plugin according to the marketplace
workflow.

When uninstalling, remove the plugin and revoke or rotate Pipedrive tokens that
were configured for it. If Claude reports retained plugin data or credentials,
delete those as part of offboarding.
