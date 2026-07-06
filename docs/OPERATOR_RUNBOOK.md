# Operator Runbook

This runbook covers local and private-client operation of `pipedrive-mcp`.

## Install And Build

```sh
npm install
npm run check
npm run build
```

Use `node dist/server.js` as the MCP command.

For Claude Cowork or Claude Code plugin delivery:

```sh
npm run pack:claude-plugin
claude plugin validate dist/claude-plugin/pipedrive-mcp
```

The plugin artifact is staged at `dist/claude-plugin/pipedrive-mcp/`.

## Environment Contract

Required for live API calls:

- `PIPEDRIVE_COMPANY_DOMAIN` or `PIPEDRIVE_BASE_URL`
- `PIPEDRIVE_API_TOKEN` or `PIPEDRIVE_ACCESS_TOKEN`

Operational flags:

- `PIPEDRIVE_ENABLE_WRITES=false` by default. Set to `true` to register CRM
  write tools.
- `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=false` by default. Set to `true` together
  with writes to register Mailbox tools.
- `PIPEDRIVE_ENABLE_DELETE_TOOLS=false` by default. Set to `true` together with
  writes to register delete tools.
- `PIPEDRIVE_LOAD_DOTENV=true` by default. Set to `false` when the MCP host
  supplies all environment variables.
- `PIPEDRIVE_REQUEST_TIMEOUT_MS=10000` by default.
- `PIPEDRIVE_ALLOW_MOCK_BASE_URL=false` by default. Use `true` only for loopback
  mocked tests.

Only the local `.env` next to the package is loaded. Parent `.env` files are
ignored.

## Write Operation

CRM write tools are hidden unless `PIPEDRIVE_ENABLE_WRITES=true`.

Every write tool defaults to `dry_run=true`. To execute a real write, the caller
must pass `dry_run=false` and the server must have writes enabled. No per-call
confirmation string is required in this production contract.

Use `validate_links=true` when a write references existing Pipedrive record IDs.
The server will read those linked records before sending the write.

## Delete Operation

Delete tools are hidden unless both flags are enabled:

```sh
PIPEDRIVE_ENABLE_WRITES=true
PIPEDRIVE_ENABLE_DELETE_TOOLS=true
```

Delete calls still default to `dry_run=true`.

## Mailbox

Mailbox tools are hidden unless both flags are enabled because mailbox linking
is a write operation and mailbox reads can expose sensitive email metadata:

```sh
PIPEDRIVE_ENABLE_WRITES=true
PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true
```

Some accounts may require OAuth scopes for Mailbox. Provide
`PIPEDRIVE_ACCESS_TOKEN` when API-token access is rejected. This MCP does not
perform OAuth authorization or token refresh.

Mailbox draft creation, sending, and replies are not supported by this MCP
version. To create an email to-do, use `pipedrive_create_activity` with
`type="email"` and place the draft body or instructions in `note`.

## Private Package Delivery

The package is private and is not prepared for public npm publication. Use:

```sh
npm pack --dry-run
npm pack
```

The tarball should contain runtime files, README, LICENSE, config example, and
docs only. It must not include source, tests, historical validation notes, or
validation prompts.

## Private Claude Plugin Delivery

Use `npm run pack:claude-plugin` to stage a Cowork/Claude Code skills plugin.
Routine delivery should use a private plugin repository or private Claude plugin
marketplace. Use `claude --plugin-dir` only for local pilot testing.

The Claude repository plugin contains skills only. The editable connector is the
Pipedrive MCP Desktop Extension (`.mcpb`), where users configure
`company_domain`, API/OAuth token, write flags, and timeout. After the extension
starts with complete credentials, it writes a managed `mcpServers.pipedrive`
entry into Claude Desktop config for Cowork discovery. The plugin Connectors
screen is read-only and must not be used as the credential entry point.

Before Cowork rollout, confirm custom plugins are allowed, users can install the
`.mcpb` extension, users can edit extension settings after install, and local
Claude Desktop MCP servers are available to Cowork tasks after a restart or new
task.

Use the release script to publish the Desktop Extension and plugin repository.
It builds and validates the local package, syncs the distribution repository,
creates both a versioned `.mcpb` and `pipedrive-mcp-latest.mcpb`, then verifies
published downloads after push.

For a local dry run against a checked-out distribution repository:

```sh
PIPEDRIVE_MCP_PLUGIN_REPO=/path/to/pipedrive-mcp-claude-plugin \
  npm run prepare:claude-plugin-release
```

For an actual publication:

```sh
PIPEDRIVE_MCP_PLUGIN_REPO=/path/to/pipedrive-mcp-claude-plugin \
  npm run release:claude-plugin
```

Do not hand-edit the distribution repository for ordinary releases.

## Upgrading From Lab Version

Remove these environment variables from host configs:

- `PIPEDRIVE_WRITE_CONFIRMATION`
- `PIPEDRIVE_REQUIRE_WRITE_CONFIRMATION`
- `PIPEDRIVE_ALLOW_LAB_WRITE_CONFIRMATION`
- `PIPEDRIVE_REQUIRE_LAB_PREFIX`
- `PIPEDRIVE_LAB_PREFIX`

Remove these fields from tool calls:

- `confirmation`
- `confirm_lab_write`

Use the new flags instead:

- `PIPEDRIVE_ENABLE_WRITES=true` to register CRM write tools.
- `PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true` to register Mailbox tools.
- `PIPEDRIVE_ENABLE_DELETE_TOOLS=true` to register delete tools.

Parent directory `.env` files are no longer loaded. Move required variables into
the MCP package `.env` or the MCP host configuration.

## Validation

Required local validation:

```sh
npm run check
npm run pack:claude-plugin
PIPEDRIVE_MCP_PLUGIN_REPO=/path/to/pipedrive-mcp-claude-plugin npm run prepare:claude-plugin-release
claude plugin validate dist/claude-plugin/pipedrive-mcp
npm pack --dry-run
```

Do not run live writes as part of ordinary validation. If live credentials are
already configured, limit manual checks to read-only tools unless an operator
explicitly approves a write test.
