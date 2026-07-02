# Troubleshooting

## Missing Configuration

Error mentions `PIPEDRIVE_API_TOKEN or PIPEDRIVE_ACCESS_TOKEN`:

- Set `PIPEDRIVE_API_TOKEN`, or set `PIPEDRIVE_ACCESS_TOKEN`.
- Also set `PIPEDRIVE_COMPANY_DOMAIN` or `PIPEDRIVE_BASE_URL`.

## Invalid Base URL

`PIPEDRIVE_BASE_URL` must point to `https://*.pipedrive.com`.

For Claude Desktop Extension installs, leave **Pipedrive base URL** empty unless
support explicitly gave you a full Pipedrive URL. Put only the company
subdomain in **Pipedrive company domain**. For example, use `acme`, not
`https://acme.pipedrive.com`.

If `pipedrive_health_check` succeeds but `pipedrive_get_current_user` fails with
an invalid `PIPEDRIVE_BASE_URL` error, check both fields:

- **Pipedrive company domain** should contain only the subdomain.
- **Pipedrive base URL** should usually be empty.

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

For Claude plugin installs, confirm the plugin is enabled and its plugin options
are configured. Reload or restart Claude after changing plugin options so the
bundled MCP server receives the updated values.

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

Claude Desktop Extension delivery sets `PIPEDRIVE_LOAD_DOTENV=false`. Configure
values through extension settings, not `.env`. With complete credentials, the
extension synchronizes those values into a managed Claude Desktop MCP entry for
Cowork discovery.

## Claude Plugin Validation Fails

Run:

```sh
npm run pack:claude-plugin
claude plugin validate dist/claude-plugin/pipedrive-mcp
```

If validation fails, check that the staged repository plugin artifact contains
`.claude-plugin/` and `skills/`, and does not contain `.mcp.json` or
`dist/plugin-server.js`.

## Claude Plugin Loads But Pipedrive Tools Are Missing

Check:

- The plugin is enabled.
- The `.mcpb` Desktop Extension is installed and configured with a company
  domain and either an API token or OAuth access token.
- Claude Desktop has been restarted, or a new Cowork task has been started,
  after saving extension settings.
- `~/Library/Application Support/Claude/claude_desktop_config.json` contains a
  managed `mcpServers.pipedrive` entry.
- If Cowork still cannot see the tools, `node` may need to be available to
  Claude Desktop. The Desktop Extension itself can use Claude Desktop's
  integrated Node.js runtime, but the managed Cowork discovery entry launches
  the bundled server with `command: "node"`.
- Custom plugins and local MCP connectors are allowed by workspace policy.

The repository plugin Connectors tab is read-only by design. Edit Desktop
Extension settings to change `PIPEDRIVE_COMPANY_DOMAIN`, token, or flags. Do
not manually edit the managed MCP entry unless support asks for it.

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
