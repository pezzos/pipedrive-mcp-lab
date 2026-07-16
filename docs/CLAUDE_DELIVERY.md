# Claude Delivery

Version `0.3.0` produces three delivery families from one source repository:

| Artifact | Audience | Surfaces | Connector |
| --- | --- | --- | --- |
| Standalone skill ZIPs | Claude Free and users who want selected workflows | Web and Desktop Chat | User adds the remote connector manually |
| Claude plugin | Pro, Max, Team, Enterprise | Web Chat, Desktop Chat, eligible Cowork surfaces (see acceptance below) | Plugin declares the remote HTTP connector |
| Desktop Extension `.mcpb` | Local Desktop fallback only | Claude Desktop | Local stdio server and locally stored settings |

The source of truth for both skill deliveries is `plugin/claude/skills/`. The
standalone and plugin packagers copy that source; they never maintain separate
skill implementations.

## Sandbox boundary

The cross-surface artifacts declare only:

```text
https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp
```

This hostname and the connected Pipedrive tenant are for the sandbox pilot.
Publishing a production artifact or changing the hostname is a separate
operator-controlled promotion.

The remote Worker owns Pipedrive OAuth storage and refresh. Each Claude user
authenticates through Cloudflare Access and receives only their effective tool
policy. No Pipedrive credential, Access token, static OAuth client, or secret is
embedded in a skill ZIP or plugin artifact.

## Build artifacts

```sh
npm run check
npm run pack:claude-skills
npm run pack:claude-plugin
claude plugin validate dist/claude-plugin/pipedrive-mcp
npm run prepare:claude-plugin-release
```

Outputs:

```text
dist/claude-skills/
  manifest.json
  <skill>-0.3.0.zip
  <skill>-latest.zip

dist/claude-plugin/pipedrive-mcp/
  .claude-plugin/plugin.json
  .mcp.json
  skills/
  docs/

dist/release/pipedrive-mcp-claude-plugin/
  .claude-plugin/
  .mcp.json
  skills/
  standalone-skills/
  pipedrive-mcp-0.3.0.mcpb
  pipedrive-mcp-latest.mcpb
```

Every standalone ZIP contains exactly one top-level skill folder with its
`SKILL.md` and optional resources. `manifest.json` records a normalized content
SHA-256 that ignores ZIP timestamps. A release refuses to reuse an existing
version when plugin or standalone-skill content differs.

## Free installation contract

Free users upload each desired ZIP separately from **Customize > Skills** and
then add the remote `/mcp` URL under **Customize > Connectors**. A Free account
is currently limited to one custom remote connector. The ZIP does not install
or authenticate the connector.

Cowork requires a paid Claude plan. The Free contract covers standard Web and
Desktop Chat only; standard mobile Chat is not part of this pilot.

## Paid plugin contract

Paid users install the private marketplace plugin. The plugin contributes all
seven skills and its root `.mcp.json` declares exactly one server with only:

```json
{
  "type": "http",
  "url": "https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp"
}
```

The plugin stays disabled by default until the user or organization enables
it. Team and Enterprise owners may distribute it through an organization
marketplace. Access OAuth remains per user.

## Surface acceptance

- Web Chat and Desktop Chat: plugin skills and remote connector are supported.
- Cowork Desktop: mandatory manual pilot test.
- Cowork Mobile: mandatory manual pilot test on the latest mobile app when the
  current beta rollout has reached the target account.
- Cowork Web: test when the beta is available in the target account or organization;
  do not promise it before that test passes.
- Standard mobile Chat: outside this pilot commitment.

Local automated checks prove artifact shape, safety, and release consistency.
They do not prove Anthropic's hosted execution behavior. Record the client-side
Cowork acceptance separately after publication.

## Local fallback and duplicate prevention

The `.mcpb` is retained for a Desktop-only local mode. It stores supplied
Pipedrive credentials in extension settings and runs the bundled Node server.
It cannot provide Cowork, Web, or Mobile access.

Do not enable the local `.mcpb`, a legacy `claude_desktop_config.json` entry,
and the remote connector simultaneously. They expose the same `pipedrive_*`
tools. Disconnect or disable the unused path before testing another.

## Safety defaults

- Standalone ZIPs contain skill instructions only.
- The paid plugin contains a reviewed static remote URL but no headers, env,
  command, local server, credentials, or secrets.
- Remote users start read-only and manage only their own policy at `/settings`.
- Real writes still require both an enabled user policy and `dry_run=false`.
- Delete and Mailbox tools remain separately gated.
- The plugin directs Claude to use only `pipedrive_*` tools.

## Publication

Routine preparation uses `npm run prepare:claude-plugin-release`. Actual
publication uses `npm run release:claude-plugin`, which clones the compatibility
distribution repository, refuses changed content under an existing version,
commits actual changes, pushes, and validates published downloads. Publication
is not part of ordinary local validation.

Platform statements were checked on 2026-07-16 against Anthropic's
[custom skills guide](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills),
[plugins guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude),
[Cowork surface guide](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile), and
[remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
