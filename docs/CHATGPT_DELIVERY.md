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
`asdk_app...` resource reference. The tracked source also carries the distinct
`plugin_asdk_app...` remote-plugin installation ID; it is release metadata and
is never transformed into the app manifest. That app-backed resource encapsulates
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
ChatGPT reported no app actions available yet. External acceptance belongs to
B8.

Do not combine the managed ChatGPT app with a manually configured duplicate
Pipedrive MCP endpoint. The package is read-only by default; any future write,
Mailbox, Delete, Access membership, tenant approval, or OAuth action requires
its own gate.

## B3 isolated lifecycle proxy

`npm run pack:chatgpt-lifecycle` creates a receipt-bound release manifest.
`npm run accept:chatgpt-lifecycle` uses only generated profiles beneath
`dist/chatgpt-lifecycle/profiles/` and actual local Codex marketplace commands
to install, update, disable, enable, uninstall, and reinstall the private
plugin. It verifies one app declaration and the seven package skills; it does
not authenticate, discover tools, or contact MCP.

Its update proof starts from a generated **synthetic previous-release fixture**:
the local ten-file `0.3.3` copy differs only in plugin-manifest version and is
not historical or published. Lifecycle actions snapshot the whole generated
profile, use external generated lock/backup paths, fail closed on any cache,
mode, type, symlink, TOML-block, or extra-version drift, and restore the exact
snapshot on a failed mutation. A successful uninstall returns the generated
fixture profile byte/type/mode-identical, including unrelated temporary and
foreign-cache entries. `results.json` is the deterministic operator receipt.

The direct-MCP fallback is deliberately a plan only. Its exact secret-free
command is `codex mcp add pipedrive-sandbox --url
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp`; the local adapter rejects it
before spawning because Codex begins dynamic client registration. Same-name and
same-URL conflicts plus offline diagnostics are fixture-tested. The external
connection, DCR, Access authentication, action, tool discovery, and first safe
read remain B8 gates.
An observed isolated `invalid_client_metadata` result is registration-unaccepted,
not an offline condition: do not retry automatically or add secrets.
