# Installing Pipedrive MCP in Claude Desktop

This guide is for a non-technical user. Install and test in Claude Desktop
chat. This local package is not available in Cowork.

## Before You Start

You need:

- Claude Desktop installed and signed in.
- A Pipedrive API token.
- The company's Pipedrive domain.
  - Example: for `https://acme.pipedrive.com`, enter only `acme`.

You do not need to install Node.js. Claude Desktop includes the runtime used by
Desktop Extensions.

## What You Will Install

There are two pieces:

- The Claude plugin: adds the Pipedrive skills used by Claude.
- The Desktop Extension file (`.mcpb`): adds the local Pipedrive connector and
  the settings screen where you enter the Pipedrive domain and API token.

Both pieces are required.

Do not use Claude's official Pipedrive connector for this workflow. The
instructions and safety defaults here apply only to the custom `pipedrive_*`
tools installed by this package, not to the official connector's different
tools and behavior.

## 1. Install The Claude Plugin

1. Open Claude Desktop.
2. Open **Customize**. In the current Claude Desktop UI, this opens
   **Settings** with the **Personalize** section.
3. Open **Personalize** > **Plugins**.
4. Click **Add plugin**.
5. Paste this plugin URL:

   ```text
   https://github.com/pezzos/pipedrive-mcp-claude-plugin
   ```

6. Install **Pipedrive MCP**.
7. Enable it if Claude does not enable it automatically.

Expected result: **Pipedrive MCP** appears in your personal plugins, with
Pipedrive skills available.

If Claude says personal plugins are not allowed, ask the Claude workspace admin
to allow this private plugin.

## 2. Install The Pipedrive Connector

1. Download this file:

   ```text
   https://github.com/pezzos/pipedrive-mcp-claude-plugin/raw/main/pipedrive-mcp-latest.mcpb
   ```

2. Open the downloaded file `pipedrive-mcp-latest.mcpb`.
3. Claude Desktop should open the **Pipedrive MCP** extension install screen.
4. Click **Install** or **Update**.
5. If Claude asks **Do you want to install Pipedrive MCP?**, click
   **Install**.
6. On the extension page, make sure the switch shows **Enabled**. If it shows
   **Disabled**, turn it on.

If double-clicking the file does not open Claude Desktop:

1. Open Claude Desktop.
2. Open **Settings**.
3. Open **Desktop app** > **Extensions**.
4. Click **Install extension**.
5. Select `pipedrive-mcp-latest.mcpb`.

## 3. Configure Pipedrive

After installation, Claude should automatically open **Configure Pipedrive
MCP**.

1. Fill in:
   - **Pipedrive company domain**: only the subdomain, for example `acme`.
     Do not paste the full URL here.
   - **Pipedrive API token**: the API token from Pipedrive.
2. Leave **Pipedrive base URL** empty unless support gave you a full Pipedrive
   URL.
3. Leave **Pipedrive OAuth access token** empty unless support gave you an
   OAuth token.
4. Leave these disabled for the first test:
   - **Enable write tools**
   - **Enable Mailbox tools**
   - **Enable delete tools**
5. Keep **Request timeout** at `10000`.
6. Click **Save**.

To change these settings later:

1. Open **Settings**.
2. Open **Desktop app** > **Extensions**.
3. Open the **Pipedrive MCP** extension settings.

Do not configure this in a plugin **Connectors** screen. The editable settings
are in the Desktop Extension.

## 4. Restart Claude Desktop

1. Fully quit Claude Desktop.
2. Open Claude Desktop again.

## 5. Test In Claude Desktop Chat

1. Open a new Claude Desktop chat.
2. Ask:

   ```text
   Validate Pipedrive MCP without any write. First run pipedrive_health_check, then run pipedrive_get_current_user as a read-only API smoke test. Use only pipedrive_* tools.
   ```

3. If Claude asks permission to use a Pipedrive MCP tool, open the permission
   menu and choose **Allow once** for the first test.

Expected result:

- Claude can use the `pipedrive_*` tools.
- `pipedrive_health_check` says the Pipedrive domain and token are configured.
- `pipedrive_get_current_user` confirms the token works against the live
  Pipedrive API.
- Write tools remain disabled while **Enable write tools** is disabled.

If this test fails, check the extension settings and the extension logs in
Claude Desktop. Do not install Node.js as a workaround.

## Cowork Availability

This local Desktop Extension is not available in Cowork. A legacy managed
`claude_desktop_config.json` entry from version `0.1.6` or earlier is not
available there either. Anthropic's
current documentation states that local Desktop-configured MCP servers are not
available in Cowork or `claude.ai`. A separately hosted remote MCP connector is
required for reliable Cowork, web, and mobile access.

These platform statements were checked on 2026-07-15 against Anthropic's
[local MCP server guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop),
[remote MCP connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), and
[desktop versus web connector guide](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).
