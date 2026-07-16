# Operator Runbook

This runbook covers local and private-client operation of `pipedrive-mcp`.
For the Cloudflare Worker, Access, and Pipedrive OAuth procedure, use the
[remote MCP runbook](REMOTE_MCP_CLOUDFLARE.md).

## Install And Build

```sh
npm install
npm run check
npm run build
```

Use `node dist/server.js` as the MCP command.

For both Claude delivery variants:

```sh
npm run pack:claude-delivery
claude plugin validate dist/claude-plugin/pipedrive-mcp
```

Standalone ZIPs are staged at `dist/claude-skills/`. The plugin artifact is
staged at `dist/claude-plugin/pipedrive-mcp/`.

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
ignored. An unreadable optional `.env` no longer prevents MCP startup;
`pipedrive_health_check` reports `dotenv_load_failed=true` for diagnosis.

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

Mailbox read tools are hidden unless the Mailbox flag is enabled. Linking a
thread additionally requires writes because it changes Pipedrive:

```sh
PIPEDRIVE_ENABLE_MAILBOX_TOOLS=true
```

Add `PIPEDRIVE_ENABLE_WRITES=true` only when mail linking is required.

Some accounts may require OAuth scopes for Mailbox. The local server accepts an
externally supplied `PIPEDRIVE_ACCESS_TOKEN`; the remote Worker obtains and
refreshes the tenant OAuth grant.

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

## Private Claude Delivery

Use `npm run pack:claude-delivery` to stage the standalone skill ZIPs and the
plugin. Routine paid delivery should use a private plugin repository or private
Claude plugin marketplace. Use `claude --plugin-dir` only for local pilot
testing.

The paid plugin contains the seven skills and exactly one remote HTTP connector
in its root `.mcp.json`. Pro, Max, Team, and Enterprise users install that
plugin. Free users import selected files from `standalone-skills/` and add the
same remote `/mcp` URL manually. Each archive must contain one top-level skill
folder with its `SKILL.md`, and no connector or credentials.

Cowork Desktop and Cowork Mobile are mandatory pilot acceptance surfaces.
Validate Cowork Web when it is enabled for the target organization. Users
authenticate through Cloudflare Access and manage only their own permissions at
`/settings`; the admin completes Pipedrive OAuth once.

Before handing off either installation path, add the user's exact email or IdP
group to the Cloudflare Access application's Allow policy. Record who owns this
onboarding step. Importing a skill or plugin does not grant Access membership.

The `.mcpb` remains a local Claude Desktop fallback where users configure
`company_domain`, API/OAuth token, write flags, and timeout. It is an alternative
to the remote connector, not an additional step. Never activate the `.mcpb`, a
legacy `claude_desktop_config.json` entry, and the remote connector at the same
time.

The source server, MCPB manifest, skills, and marketplace now live in this one
canonical repository. The existing `pipedrive-mcp-claude-plugin` repository is
kept as a generated compatibility distribution so installed client URLs do not
change.

Use the release script to publish the Desktop Extension and plugin repository.
It builds and validates the local package, syncs the distribution repository,
creates both a versioned `.mcpb` and `pipedrive-mcp-latest.mcpb`, generates
versioned and `latest` standalone skill ZIPs, then verifies published downloads
after push.

For local preparation, no second checkout is required:

```sh
npm run prepare:claude-plugin-release
```

The complete distribution is generated under
`dist/release/pipedrive-mcp-claude-plugin/`. An explicit existing checkout is
still supported through `--distribution-repo` or
`PIPEDRIVE_MCP_PLUGIN_REPO` for backward compatibility.

For an actual publication:

```sh
PIPEDRIVE_MCP_PLUGIN_GIT_URL=https://github.com/pezzos/pipedrive-mcp-claude-plugin.git \
  npm run release:claude-plugin
```

Publication clones the compatibility repository into a temporary directory,
generates and validates the distribution, refuses to overwrite a released
version with different content, commits only actual changes, pushes `main`, and
verifies the published downloads. Do not hand-edit the distribution repository
for ordinary releases.

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
npm run benchmark:server
npm run pack:claude-delivery
npm run prepare:claude-plugin-release
claude plugin validate .
claude plugin validate dist/claude-plugin/pipedrive-mcp
npm pack --dry-run
```

Do not run live writes as part of ordinary validation. If live credentials are
already configured, limit manual checks to read-only tools unless an operator
explicitly approves a write test.

Platform behavior was checked on 2026-07-16 against Anthropic's
[local MCP server guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
[skills guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude),
[plugins guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude), and
[Cowork surface guide](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile).
The monorepo marketplace layout was checked separately against Anthropic's
[plugin marketplace documentation](https://code.claude.com/docs/en/plugin-marketplaces).
