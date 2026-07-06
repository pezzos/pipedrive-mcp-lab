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

Install and test in Claude Desktop chat first. Then validate Claude Cowork if
you want project workspaces and persistent working documents.

Do not use Claude's official Pipedrive connector for this workflow. Use only
the `pipedrive_*` tools provided by Pipedrive MCP.
