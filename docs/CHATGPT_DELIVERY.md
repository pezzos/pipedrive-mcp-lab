# ChatGPT Delivery

## Local package contract

`npm run pack:chatgpt-plugin` produces the private, local-only **Pipedrive
Sandbox** package at:

```text
dist/chatgpt-plugin/pipedrive-sandbox-0.3.4/
```

The adjacent `pipedrive-sandbox-0.3.4.sha256.json` receipt has sorted file
paths, file modes, SHA-256 hashes, and a tree hash. Rebuilding from unchanged
inputs produces the same package contents and receipt.

The package contains exactly ten files: one marketplace record, one plugin
manifest, one app manifest, and the seven canonical workflow `SKILL.md` files.
The tracked source contract freezes the sandbox MCP URL:

```text
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
```

The generated ten-file package intentionally does **not** contain that URL or a
direct MCP configuration. Its `.app.json` carries only the one required real
`plugin_asdk_app...` resource reference. That app-backed resource encapsulates
the sandbox endpoint; adding `.mcp.json`, `mcpServers`, or a direct URL would
create a second configuration contract and is forbidden.

Its generated metadata follows the local app-backed plugin shapes: the
marketplace record contains its display interface and local source/policy, while
the plugin manifest owns the app path and supported interface metadata. Starter
prompts are `interface.defaultPrompt`, not marketplace listing fields.

It has no `.mcp.json`, `mcpServers`, local server, MCPB, archive, credentials,
headers, tokens, source, test files, symbolic links, or nested artifacts.

## Listing

- Name: `Pipedrive Sandbox`
- Description: `Private sandbox for seven controlled Pipedrive workflows. Read-only by default.`
- Safety labels, in order: `Private sandbox`; `Read-only by default`
- Visual: `Controlled Pipeline`
- Distribution: private to named pilot workspaces/users

The supported plugin interface includes the three starter prompts. The seven
skills are copied byte for byte from `plugin/claude/skills/`; that directory
remains the canonical workflow source for this B2 package and for Claude
compatibility delivery.

## Installation boundary

This is only a deterministic local package. It does not install the app, open a
ChatGPT session, authenticate through Cloudflare Access, complete Pipedrive
OAuth, discover actions, or call an MCP tool. The app remains disconnected and
ChatGPT reported no app actions available yet. Those lifecycle and external
acceptance steps belong to B3 and B8.

Do not combine the managed ChatGPT app with a manually configured duplicate
Pipedrive MCP endpoint. The package is read-only by default; any future write,
Mailbox, Delete, Access membership, tenant approval, or OAuth action requires
its own gate.
