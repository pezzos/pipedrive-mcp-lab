# Troubleshooting

## Missing Configuration

Error mentions `PIPEDRIVE_API_TOKEN or PIPEDRIVE_ACCESS_TOKEN`:

- Set `PIPEDRIVE_API_TOKEN`, or set `PIPEDRIVE_ACCESS_TOKEN`.
- Also set `PIPEDRIVE_COMPANY_DOMAIN` or `PIPEDRIVE_BASE_URL`.

## Invalid Base URL

`PIPEDRIVE_BASE_URL` must point to `https://*.pipedrive.com`.

Loopback URLs are accepted only for tests:

```sh
PIPEDRIVE_ALLOW_MOCK_BASE_URL=true
PIPEDRIVE_BASE_URL=http://127.0.0.1:3000
```

## Tools Are Missing

CRM write tools are absent unless:

```sh
PIPEDRIVE_ENABLE_WRITES=true
```

Mailbox tools are absent unless:

```sh
PIPEDRIVE_ENABLE_WRITES=true
PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true
```

Delete tools are absent unless:

```sh
PIPEDRIVE_ENABLE_WRITES=true
PIPEDRIVE_ENABLE_DELETE_TOOLS=true
```

Restart the MCP host after changing environment variables.

For Claude plugin installs, also confirm the plugin is enabled and the MCP
server appears in Claude's MCP/plugin UI. The plugin is disabled by default.

## Writes Return Dry-Run Responses

Write tools default to `dry_run=true`. Pass `dry_run=false` for a real write and
make sure writes are enabled in the server environment.

## Mailbox Access Fails

Some Pipedrive accounts require OAuth scopes for Mailbox endpoints. Try an
externally supplied `PIPEDRIVE_ACCESS_TOKEN`. This MCP does not perform OAuth
login or refresh.

Use `pipedrive_mailbox_probe` before reading thread or message content.

## Product Line Item Writes Fail

`pipedrive_add_product_to_deal` requires a valid product in the target account.
Use `pipedrive_list_products` first.

## Project Or Task Writes Fail

Project and task endpoints are beta. Confirm the target account has project
boards and phases:

- `pipedrive_list_project_boards`
- `pipedrive_list_project_phases` with the selected `board_id`

Milestone tasks require a `due_date`.

## Timeout Errors

Increase the request timeout:

```sh
PIPEDRIVE_REQUEST_TIMEOUT_MS=30000
```

## Dotenv Values Are Ignored

Only the package-local `.env` file is loaded. Parent directory `.env` files are
ignored. Existing process environment variables take precedence over `.env`
values.

Set `PIPEDRIVE_LOAD_DOTENV=false` when the MCP host supplies all variables.

Claude plugin delivery always sets `PIPEDRIVE_LOAD_DOTENV=false`; configure
values through plugin user config instead of `.env`.

## Claude Plugin Validation Fails

Run:

```sh
npm run pack:claude-plugin
claude plugin validate dist/claude-plugin/pipedrive-mcp
```

If validation fails, check that the staged artifact contains `.claude-plugin/`,
`.mcp.json`, `skills/`, and `dist/plugin-server.js`.

## Claude Plugin MCP Server Does Not Start

Check:

- The plugin is enabled.
- Plugin user config contains a company domain and either an API token or OAuth
  access token.
- Custom plugins and local MCP servers are allowed by workspace policy.
- `dist/plugin-server.js` exists in the staged plugin artifact.

Use `claude --plugin-dir dist/claude-plugin/pipedrive-mcp` for local pilot
testing before client rollout.

## Package Contents Look Wrong

Run:

```sh
npm run build
npm run pack:claude-plugin
npm pack --dry-run
```

The tarball should include runtime `dist` files, README, LICENSE, config
example, package metadata, and docs. It should not include source files, tests,
validation prompts, or historical validation notes.
