# B4 UI foundation

## Intent and register

Product interface, server-rendered in French for a calm operational setting:
an Access user or platform administrator reads a consequence and takes one
safe next action under ordinary office lighting. The interface is deliberately
restrained, closer to an ordered settings surface than a dashboard.

## Tokens and layout

- Light OKLCH neutrals, lightly tinted toward moss. Moss is the sole accent and
  is reserved for primary actions and small labels, below roughly 10% of a page.
- No pure black or white; semantic success, warning, error, and destructive
  states pair colour with explicit text.
- System font stack; fixed 1rem body, 1.25rem section heading, 2rem page title.
- Spacing follows 0.25, 0.5, 0.75, 1, 1.5, 2, 3, and 4rem increments.
- User pages measure 46rem; administration measures 76rem. Layout adjusts at
  36rem and 52rem. Values wrap, and only named table regions scroll horizontally.
- Native fields and buttons have a minimum 44 by 44 CSS pixels. Focus uses a
  visible blue outline. There is no scripted interaction or motion.

## Components

`pageShell.ts` owns the nonce-bound local style sheet, simple text navigation,
notice states, definition-list status blocks, native forms, confirmation
sections, and the named table scroller. Pages do not use images, icons,
gradients, decorative shadows, glass, side stripes, card grids, custom inputs,
or remote fonts/assets.

## Image gate

Both approved image gates are intentionally skipped. These onboarding and
administration flows communicate state, consequence, and trusted identity;
imagery adds no usable information and could distract from a high-consequence
confirmation. Semantic HTML and synthetic code-native fixtures are the
appropriate visual evidence.

## Security and evidence

Every page is rendered through the same no-store envelope: `default-src 'none'`,
nonce-only local CSS, same-origin form actions, `frame-ancestors 'none'`,
`base-uri 'none'`, same-origin referrer policy, and `nosniff`. User pages show
only the authenticated user's safe company metadata; force-disconnect targets
come from a generation-bound registry ticket, never browser-submitted display
data. This is V1 UI only: no V1.1 workflows, persistence, provider calls, or
identity fields are represented. Browser evidence must execute the actual
renderers with synthetic `.invalid` data and verify the envelope and keyboard
semantics, not an approximate mock.

## Accepted component contract

Controls use native semantics, a 44px minimum target, visible focus outline,
and quiet hover, active, and disabled states without motion. The fixed type
scale is 1rem body, 1.25rem section heading, and 2rem page title; prose stays
within 70ch and spacing uses the approved quarter-rem rhythm. Calm,
consequence-first French names the next owner and never relies on colour alone.
The browser matrix covers disconnected, connected, replacement, recovery,
settings, admin, confirmation, long-value, 200-tenant, and 500-connection
synthetic renderings at compact and desktop widths. It does not exercise live
Access, OAuth, provider, CRM, or persistent user data.
