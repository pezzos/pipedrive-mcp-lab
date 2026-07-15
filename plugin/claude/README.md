# Pipedrive MCP Claude Plugin

This plugin adds Pipedrive CRM skills to Claude. Pair it with either the local
Pipedrive MCP Desktop Extension or the deployed remote MCP connector. The local
extension owns its credential settings; the remote connector uses Cloudflare
Access and per-user permission settings.

Start here:

- [English installation guide](INSTALL.md)
- [Guide d'installation en francais](INSTALL.fr.md)

## What You Install

1. The Claude plugin from this repository.
2. The Desktop Extension file:

   ```text
   https://github.com/pezzos/pipedrive-mcp-claude-plugin/raw/main/pipedrive-mcp-latest.mcpb
   ```

Install and test in Claude Desktop chat. The `.mcpb` extension uses Claude
Desktop's integrated Node.js runtime; a separate Node.js install is not needed.

The local package is not available in Cowork. Use the version `0.2.0` remote
connector there: add the admin-provided `/mcp` URL, complete Cloudflare Access
login, and use `/settings` to manage only your own capabilities. No Pipedrive
token is entered by the user.

Do not use Claude's official Pipedrive connector for this workflow. Use only
the `pipedrive_*` tools provided by Pipedrive MCP; the official connector's
different tools do not share this package's safety defaults.

Platform details and their verification sources are maintained in the
[Claude delivery guide](docs/CLAUDE_DELIVERY.md).
