# Claude Delivery

Version `0.3.3` produces three delivery families from one source repository:

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

Commit `c7398c9` was deployed and smoke-tested at that hostname as Worker
version `d0b493c2-7cbe-411d-af29-e7d08562c28a`. Verify the active deployment
before onboarding: the hardcoded URL does not prove which version is currently
serving traffic.

The checked-in Worker isolates one Pipedrive OAuth connection per Access subject
and one permission policy per `(Access sub, company_id)`. The global platform
administrator approves, suspends, and resumes Pipedrive company subdomains but
never receives a user's OAuth token. Real two-user/two-company OAuth, deployed
suspension, client rollout, and production promotion remain behind the canonical
[deployment gate](REMOTE_MCP_CLOUDFLARE.md#implemented-tenancy-boundary-and-deployment-gate).

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
  <skill>-0.3.3.zip
  <skill>-latest.zip

dist/claude-plugin/pipedrive-mcp/
  .claude-plugin/plugin.json
  .mcp.json
  skills/
  docs/

dist/release/pipedrive-mcp-claude-plugin/
  .claude-plugin/
  README.md
  INSTALL.md
  INSTALL.fr.md
  LICENSE
  docs/
  plugin/
    .claude-plugin/plugin.json
    .mcp.json
    skills/
  standalone-skills/
    manifest.json
    README.md

dist/release/assets/
  <skill>-0.3.3.zip
  <skill>-latest.zip
  standalone-skills-manifest.json
  pipedrive-mcp-0.3.3.mcpb
  pipedrive-mcp-latest.mcpb
```

The root documentation is duplicated intentionally so GitHub renders the
installation and operating guidance without requiring users to browse inside
the installable `plugin/` subtree.

Every standalone ZIP contains exactly one top-level skill folder with its
`SKILL.md` and optional resources. `manifest.json` records a normalized content
SHA-256 that ignores ZIP timestamps. A release refuses to reuse an existing
version when plugin or standalone-skill content differs.

Claude's hosted marketplace installer scans the complete repository snapshot
before applying the plugin's `source` subdirectory. The distribution branch
therefore contains no ZIP, MCPB, compressed archive extension, or disguised ZIP
payload anywhere. Standalone skills and the Desktop fallback are published as
GitHub Release assets, outside the Git tree.

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
- Each remote user connects their own approved company at `/pipedrive`, starts
  read-only, and manages only that user-company policy at `/settings`.
- Real writes still require both an enabled user policy and `dry_run=false`.
- Delete and Mailbox tools remain separately gated.
- The plugin directs Claude to use only `pipedrive_*` tools.

## Publication

Routine preparation uses `npm run prepare:claude-plugin-release`. Actual
publication uses `npm run release:claude-plugin`, which clones the compatibility
distribution repository, refuses changed content under an existing version,
commits and pushes the archive-free snapshot, uploads immutable GitHub Release
assets, and validates those published downloads. A staging branch can be chosen
with `--distribution-git-branch`; staging runs use `--skip-release-assets` and
`--skip-remote-verify`. Publication is not part of ordinary local validation.

Platform statements were checked on 2026-07-16 against Anthropic's
[custom skills guide](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills),
[plugins guide](https://support.claude.com/en/articles/13837440-use-plugins-in-claude),
[Cowork surface guide](https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile), and
[remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
