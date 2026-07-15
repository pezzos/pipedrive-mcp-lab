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

If `pipedrive_health_check` reports `configuration_valid=false` with an invalid
`PIPEDRIVE_BASE_URL` error, check both fields:

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

For Claude Desktop installs, confirm the `.mcpb` extension is enabled and its
extension settings are configured. Restart Claude Desktop after changing them.

## Writes Return Dry-Run Responses

Write tools default to `dry_run=true`. Pass `dry_run=false` for a real write and
make sure writes are enabled in the server environment.

## Mailbox Access Fails

Some Pipedrive accounts require OAuth scopes for Mailbox endpoints. The local
server accepts an externally supplied `PIPEDRIVE_ACCESS_TOKEN`; the remote
Worker obtains and refreshes OAuth after the admin connects Pipedrive.

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

If the local `.env` exists but cannot be read, the server continues to start and
`pipedrive_health_check` reports `dotenv_load_failed=true`. Fix the file or
disable dotenv loading after confirming the MCP host supplies every value.

Set `PIPEDRIVE_LOAD_DOTENV=false` when the MCP host supplies all variables.

Claude Desktop Extension delivery sets `PIPEDRIVE_LOAD_DOTENV=false`. Configure
values through extension settings, not `.env`.

## Claude Plugin Validation Fails

Run:

```sh
npm run pack:claude-plugin
claude plugin validate dist/claude-plugin/pipedrive-mcp
```

If validation fails, check that the staged repository plugin artifact contains
`.claude-plugin/` and `skills/`, and does not contain `.mcp.json` or
`dist/plugin-server.js`.

## Claude Desktop Extension Loads But Pipedrive Tools Are Missing

Check:

- The `.mcpb` Desktop Extension is installed and configured with a company
  domain and either an API token or OAuth access token.
- Claude Desktop has been fully restarted after saving extension settings.
- The extension status and logs under **Settings > Extensions** do not show a
  startup or configuration error.
- `pipedrive_health_check` reports `configuration_valid=true`.
- Desktop Extensions are allowed by workspace and device policy.

Edit Desktop Extension settings to change the Pipedrive domain, token, or flags.
Do not install Node.js: Claude Desktop supplies the extension runtime.

Use `claude --plugin-dir dist/claude-plugin/pipedrive-mcp` for local pilot
testing of the skills before client rollout. This does not configure the MCP
server in Claude Code.

## Pipedrive Tools Are Missing In Cowork

The local `.mcpb` is unavailable in Cowork and `claude.ai`. Connect the deployed
remote URL ending in `/mcp`; restarting Claude Desktop or installing Node.js
cannot turn the local extension into a remote connector. If the remote
connector is already present, complete the Cloudflare Access login and verify
that the user is allowed by the Access policy.

This platform behavior was checked on 2026-07-15 against Anthropic's
[local MCP server guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), and
[desktop versus web connector guide](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).

## Remote Connector Errors

- `access_denied` or `access_configuration_invalid`: verify Worker variables,
  Access policy, issuer, and audience.
- `access_token_missing` or `access_token_invalid`: reconnect the Claude
  connector and verify that the user remains allowed by Access.
- `access_jwks_unavailable` or `access_jwks_invalid`: check Access availability
  and its certificate endpoint; do not bypass JWT validation.
- `policy_unavailable`: verify the `USER_POLICY` Durable Object binding. Do not
  bypass the policy or enable tools globally.
- `pipedrive_not_connected`: the named admin visits
  `/admin/pipedrive/connect` and completes Pipedrive consent.
- `pipedrive_reconnect_required`: the Pipedrive grant was revoked or could not
  be refreshed; the named admin reconnects it.
- `oauth_material_invalid`: reconnect Pipedrive after encryption-key rotation
  or unreadable stored OAuth material.
- `pipedrive_oauth_failed` or `pipedrive_credential_unavailable`: check
  Pipedrive OAuth availability and Worker errors, then reconnect only if the
  grant is no longer usable.

Start with `/healthz`. A healthy response proves that the Worker route is
running, not that Access, Durable Objects, or Pipedrive are correctly
configured. Use request IDs and pseudonymous actor IDs for correlation; never
copy JWTs, OAuth tokens, encryption keys, or CRM payloads into logs or tickets.

## An Old Pipedrive Server Still Shows As Disconnected

Versions through `0.1.6` could add a marked managed entry to
`claude_desktop_config.json`. Version `0.1.7` no longer creates or needs that
entry. If an old duplicate remains after updating the extension, inspect the
file and remove only an entry whose `env` contains:

```json
"PIPEDRIVE_MANAGED_BY_PIPEDRIVE_MCP_EXTENSION": "true"
```

Do not remove an unmarked Pipedrive entry; it may be user-managed. Fully quit
and reopen Claude Desktop after saving the file, then rotate the token if the
legacy entry exposed a credential that should no longer remain there.

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
