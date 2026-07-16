# Pipedrive MCP Claude Plugin

This paid-plan plugin adds seven Pipedrive workflow skills and declares the
remote sandbox MCP connector:

```text
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
```

It is intended for Claude Pro, Max, Team, and Enterprise on Web chat, Desktop
chat, and Cowork. Cowork Desktop is a required pilot acceptance surface.
Cowork Mobile is required when Anthropic's beta rollout has reached the test
account. Cowork Web must also be validated on the target account or organization
before it is promised to a client.

After installation, each user completes Cloudflare Access authentication. The
plugin contains no Pipedrive token, OAuth client secret, Access token, or local
server. Use only the `pipedrive_*` tools; Claude's official Pipedrive connector
does not share this package's safety defaults.

Do not activate the local `.mcpb` Desktop Extension or a legacy
`claude_desktop_config.json` Pipedrive entry at the same time. Those alternative
local connectors expose the same tool names and can create duplicates.
The compatibility distribution names the local fallback
`pipedrive-mcp-latest.mcpb`.

Free-plan users install individual ZIP files from `standalone-skills/` and add
the remote connector manually instead of installing this plugin.

Start here:

- [English installation guide](INSTALL.md)
- [Guide d'installation en français](INSTALL.fr.md)
- [Claude delivery details](docs/CLAUDE_DELIVERY.md)

Version `0.3.1` is a sandbox pilot. Production promotion and a production MCP
hostname require a separate operator-approved release.
