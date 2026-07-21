# B4 Impeccable UI Evidence

## Scope and boundary

Source commit: `3c52c3d8089cbd7d23c9003a8a2a6f943f993c77`. The target is the
atomic commit containing this evidence; its SHA is intentionally not claimed
here before that commit exists.

B4 implements the approved local, server-rendered V1 interface only. It does
not claim a live deployment, a real Cloudflare Access session, Pipedrive OAuth,
CRM access, publication, or customer installation. Browser checks invoke the
actual renderers with synthetic `.invalid` identities and fixture data only.

## Approved briefs and image gate

- **A1, user connection and recovery:** the French product surface makes the
  caller’s connection state and safe next action explicit: connect, reconnect,
  replace, local disconnect, capability settings, and typed recovery. It is
  consequence-first, read-only by default, and never exposes OAuth material.
- **B1, platform administration:** the French operator surface presents
  admitted-domain and bounded connection topology, explicit approve/suspend/
  resume/force-disconnect confirmations, and trusted force-disconnect identity
  context without becoming a dashboard or a route to a user credential.
- The user approved skipping the image gate. These operational flows need
  state, consequence, and trusted identity rather than imagery; no image,
  icon, remote font, or external asset is used.

## Implemented local contract

1. The shared server renderer supplies one nonce-bound local stylesheet, a
   restrained OKLCH product system, native 44 by 44 CSS-pixel controls, visible
   focus, no client JavaScript, no external assets, and only named table
   scrollers for horizontal density.
2. Connection, settings, administration, and confirmation pages render typed,
   French notices and safe status data. Responses use no-store, nonce-only CSP,
   same-origin form actions, same-origin referrer policy, and `nosniff`.
3. Force-disconnect confirmation renders only the registry-issued,
   generation-bound ticket projection. Browser-supplied display fields cannot
   replace its e-mail, domain, or localized state.
4. Same-origin browser UI exceptions recover through typed no-store HTML or
   redirects, without a dependency retry loop. MCP/API and hostile or
   cross-origin requests retain their JSON fail-closed behavior. A malformed or
   rejected settings CSRF response cannot be interpolated into rendered HTML.

## Local verification and review

- `WRANGLER_SEND_METRICS=false npm run check` passed: 130/130.
- `npm run test:ui` passed: 26/26. The actual renderer matrix covers compact
  and desktop widths, 200% root text reflow for user/settings/recovery/density,
  keyboard traversal, 44 by 44 targets, named-overflow containment, computed
  WCAG contrast and focus contrast, and reduced-motion computed durations.
- `npm run benchmark:server` passed: p95 `3.384ms` (limit `20ms`).
- `npm pack --dry-run --json` passed with 22 files.
- Audit-level high passes; one low transitive `body-parser` finding remains.
- `git diff --check` passed.
- accessibility-tester final PASS and original Sol final PASS followed
  remediation. Claude was not used.

## Remaining external gate

None for the local UI slice. Live UI, Cloudflare Access, OAuth, provider/CRM,
and real ChatGPT-surface acceptance remain B8 work and require separate
authorization.
