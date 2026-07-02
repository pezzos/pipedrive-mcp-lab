# Installing Pipedrive MCP in Claude Desktop

This guide is for a non-technical user. Install and test in Claude Desktop chat
first. Then validate Claude Cowork if you want project workspaces and persistent
working documents.

## Before You Start

You need:

- Claude Desktop installed and signed in.
- A Pipedrive API token.
- The company's Pipedrive domain.
  - Example: for `https://acme.pipedrive.com`, enter only `acme`.

You normally do not need to install Node.js. Claude Desktop includes Node.js for
Desktop Extensions. Install Node.js only if the Cowork test at the end cannot
find the Pipedrive tools after a full Claude Desktop restart.

## What You Will Install

There are two pieces:

- The Claude plugin: adds the Pipedrive skills used by Claude.
- The Desktop Extension file (`.mcpb`): adds the local Pipedrive connector and
  the settings screen where you enter the Pipedrive domain and API token.

Both pieces are required.

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
   https://github.com/pezzos/pipedrive-mcp-claude-plugin/raw/main/pipedrive-mcp-0.1.6.mcpb
   ```

2. Open the downloaded file `pipedrive-mcp-0.1.6.mcpb`.
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
5. Select `pipedrive-mcp-0.1.6.mcpb`.

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

Do not configure this in the Claude Cowork plugin **Connectors** screen. That
screen can be read-only. The editable settings are in the Desktop Extension.

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

If this test fails, check the extension settings before trying Cowork.

## 6. Validate In Claude Cowork

Use Cowork after the Desktop chat test works.

1. Open a new Cowork task.
2. Ask:

   ```text
   Validate Pipedrive MCP in Cowork without any write. First run pipedrive_health_check, then run pipedrive_get_current_user as a read-only API smoke test. Use only pipedrive_* tools.
   ```

3. If Claude asks permission to use a Pipedrive MCP tool, open the permission
   menu and choose **Allow once** for the first test. Claude may ask once for
   each tool.

Expected result:

- Claude shows the `pipedrive` connector or can use the `pipedrive_*` tools.
- `pipedrive_health_check` says the Pipedrive domain and token are configured.
- `pipedrive_get_current_user` confirms live API connectivity.
- Write tools remain disabled while **Enable write tools** is disabled.

If Cowork cannot find the tools:

1. Fully quit Claude Desktop.
2. Open Claude Desktop again.
3. Start a new Cowork task and test again.
4. If the tools are still unavailable, install Node.js LTS from
   <https://nodejs.org>, restart Claude Desktop, and test again.

Do not use Claude's official Pipedrive connector for this workflow.
