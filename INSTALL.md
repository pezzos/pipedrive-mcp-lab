# Install Pipedrive MCP In Claude

This guide covers the version `0.3.3` sandbox pilot. It uses only:

```text
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
```

The remote connector works through Cloudflare Access. Users never enter a
Pipedrive token. The platform administrator approves the intended Pipedrive
company domain, then each Access user opens `/pipedrive` and completes OAuth
with their own Pipedrive identity. The service stores and refreshes that user's
encrypted grant only.

Choose exactly one installation path. Do not enable the remote connector and
the local `.mcpb` Desktop Extension at the same time: both expose
`pipedrive_*` tools and can create duplicates.

Before either path, the operator must add the user's exact email address or
identity-provider group to the Cloudflare Access **Allow** policy for this
application. Access is the per-user login gate in front of the MCP server; it
does not approve a Pipedrive company or create that user's Pipedrive OAuth
connection.

> **Pilot gate:** the sandbox Worker has been deployed and smoke-tested, but
> two-user/two-company OAuth and deployed suspension acceptance are still
> required before client rollout. Confirm the active Worker version and the
> [remaining sandbox acceptance](docs/REMOTE_MCP_CLOUDFLARE.md#sandbox-acceptance)
> before handing out either installation path.

## Claude Free: standalone skills

Free accounts can upload custom skills and use one custom remote connector.

1. Open the
   [latest GitHub Release](https://github.com/pezzos/pipedrive-mcp-claude-plugin/releases/latest)
   and download the wanted ZIP files. Each ZIP contains one workflow skill.
2. On Claude Web, open **Customize > Skills**, choose **Create skill**, then
   **Upload a skill**.
3. Upload each ZIP separately and enable it.
4. Open **Customize > Connectors**, add a custom connector, and enter:

   ```text
   https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
   ```

5. Leave OAuth Client ID and OAuth Client Secret empty.
6. Connect and complete the Cloudflare Access login.

A standalone skill ZIP contains instructions only. It does not contain the MCP
connector, credentials, or authentication state.

## Pro, Max, Team, or Enterprise: plugin

The paid-plan plugin provides all seven skills and declares the remote MCP
connector.

1. On Claude Web or Claude Desktop, open **Customize > Plugins**.
2. Add this private marketplace repository if it is not already available:

   ```text
   https://github.com/pezzos/pipedrive-mcp-claude-plugin
   ```

3. Install and enable **Pipedrive MCP**.
4. Open its connector and complete the Cloudflare Access login. Do not enter a
   Pipedrive token or static OAuth client credentials.

Team and Enterprise owners can distribute the plugin through the organization
marketplace. Each user still authenticates individually through Access.

## Connect your Pipedrive identity

After the connector has completed Cloudflare Access authentication:

1. The platform administrator approves the intended Pipedrive subdomain at
   `https://pipedrive-mcp-sandbox.pezzoslabs.com/admin/pipedrive`.
2. The user opens
   [`https://pipedrive-mcp-sandbox.pezzoslabs.com/pipedrive`](https://pipedrive-mcp-sandbox.pezzoslabs.com/pipedrive),
   enters that approved subdomain, and completes OAuth with their own Pipedrive
   identity.
3. The user verifies the connected company shown on `/pipedrive`. Do not infer
   it from the OAuth success screen alone.
4. The user opens `/settings` and confirms that the new user-company pair starts
   read-only.

## Supported pilot surfaces

| Surface | Free standalone skills | Paid plugin |
| --- | --- | --- |
| Claude Web chat | Supported with the manually added remote connector | Supported |
| Claude Desktop chat | Supported with the manually added remote connector | Supported |
| Cowork Desktop | Not available on the Free plan | Required manual acceptance surface |
| Cowork Mobile | Not available on the Free plan | Required when enabled for the target pilot account or organization; currently rolling out in beta |
| Cowork Web | Not available on the Free plan | Validate when enabled for the target pilot account or organization before promising it |
| Standard mobile Chat | Outside this pilot | Outside this pilot |

Install or update the plugin and standalone skills from Web or Desktop first.
Paid Cowork surfaces then use the same Claude account, enabled skills, and
remote connector. Plan eligibility does not guarantee that Anthropic's
web/mobile beta has reached a specific account.

## First read-only test

For the Free path, start in Claude Web Chat and repeat in Claude Desktop Chat.
For a paid account, start in Cowork Desktop, then repeat in Cowork Mobile and
Cowork Web only when each beta surface is enabled for the target pilot account
or organization:

```text
Validate my Pipedrive MCP connection without writing anything. First run
pipedrive_connection_check, then pipedrive_get_current_user and one known
read-only query. Report the current user and whether the returned records match
the company shown on /pipedrive. Use only pipedrive_* tools.
```

Expected result:

- Claude can see and call the `pipedrive_*` tools;
- Access authentication completes for the current user;
- `pipedrive_connection_check` accepts that user's OAuth credential;
- the current user and known records match the company shown on `/pipedrive`;
- the user starts read-only.

Open
[`https://pipedrive-mcp-sandbox.pezzoslabs.com/settings`](https://pipedrive-mcp-sandbox.pezzoslabs.com/settings)
to manage that user's Writes, Deletes, and Mailbox switches. Real writes still
require `dry_run=false`.

## Local Desktop fallback

The versioned `.mcpb` remains available only for a local Claude Desktop setup
that needs locally stored Pipedrive credentials. It is an alternative to the
remote connector, not an additional installation step. It is unavailable in
Cowork, Web, and Mobile.

Before using the fallback, disconnect the remote Pipedrive MCP connector. See
[Claude delivery](docs/CLAUDE_DELIVERY.md) and
[Troubleshooting](docs/TROUBLESHOOTING.md).

Platform statements were checked on 2026-07-16 against Anthropic's
[skills guide](https://support.claude.com/en/articles/12512180-use-skills-in-claude),
[plugins guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude),
[Cowork surface guide](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile), and
[remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
