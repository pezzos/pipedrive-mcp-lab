# Pipedrive MCP Claude Plugin

This plugin adds Pipedrive CRM skills to Claude. It must be installed together
with the Pipedrive MCP Desktop Extension, which provides the local Pipedrive
connector and the settings screen for the Pipedrive domain and API token.

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

This local package is not available in Cowork. Anthropic's current
documentation says local servers from `claude_desktop_config.json` are not
available there. A remote MCP connector is required for that surface.

Do not use Claude's official Pipedrive connector for this workflow. Use only
the `pipedrive_*` tools provided by Pipedrive MCP; the official connector's
different tools do not share this package's safety defaults.

Platform details and their verification sources are maintained in the
[Claude delivery guide](docs/CLAUDE_DELIVERY.md).
