import type { UserPolicyRecord } from "./policy.js";

export type SettingsPageInput = {
  email: string;
  policy: UserPolicyRecord;
  csrf: string;
  nonce: string;
  saved: boolean;
  error?: string;
};

export function renderSettingsPage(input: SettingsPageInput): string {
  const status = input.saved
    ? '<p class="status success" role="status">Vos permissions ont été enregistrées.</p>'
    : input.error
      ? `<p class="status error" role="alert">${escapeHtml(input.error)}</p>`
      : "";
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Permissions Pipedrive MCP</title>
  <style nonce="${escapeHtml(input.nonce)}">
    :root {
      color-scheme: light;
      --canvas: oklch(97% 0.008 155);
      --surface: oklch(99% 0.005 155);
      --surface-muted: oklch(94% 0.012 155);
      --text: oklch(24% 0.018 155);
      --muted: oklch(48% 0.018 155);
      --line: oklch(84% 0.018 155);
      --accent: oklch(48% 0.13 154);
      --accent-hover: oklch(42% 0.13 154);
      --focus: oklch(62% 0.15 240);
      --danger: oklch(48% 0.16 28);
      --danger-soft: oklch(94% 0.035 28);
      --success: oklch(43% 0.11 150);
      --success-soft: oklch(94% 0.035 150);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--canvas);
      color: var(--text);
      font-size: 1rem;
      line-height: 1.55;
    }
    main {
      width: min(100% - 2rem, 46rem);
      margin: 0 auto;
      padding: 3.5rem 0 5rem;
    }
    header { margin-bottom: 2.5rem; }
    .eyebrow {
      margin: 0 0 0.5rem;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      max-width: 22ch;
      font-size: 2rem;
      line-height: 1.15;
      letter-spacing: -0.025em;
    }
    .intro { max-width: 65ch; margin: 1rem 0 0; color: var(--muted); }
    .identity {
      display: inline-flex;
      margin-top: 1rem;
      padding: 0.35rem 0.65rem;
      border: 1px solid var(--line);
      border-radius: 0.45rem;
      background: var(--surface);
      color: var(--muted);
      font-size: 0.875rem;
    }
    form {
      border: 1px solid var(--line);
      border-radius: 0.75rem;
      background: var(--surface);
      box-shadow: 0 0.8rem 2rem oklch(24% 0.018 155 / 0.07);
      overflow: hidden;
    }
    fieldset { margin: 0; padding: 0; border: 0; }
    legend {
      width: 100%;
      padding: 1.25rem 1.35rem 0.85rem;
      font-size: 1.125rem;
      font-weight: 700;
    }
    .permission {
      display: grid;
      grid-template-columns: 1.4rem 1fr;
      gap: 0.15rem 0.8rem;
      padding: 1.1rem 1.35rem;
      border-top: 1px solid var(--line);
      cursor: pointer;
    }
    .permission:hover { background: var(--surface-muted); }
    .permission input { width: 1.15rem; height: 1.15rem; margin: 0.2rem 0 0; accent-color: var(--accent); }
    .permission strong { font-size: 1rem; }
    .permission span { grid-column: 2; color: var(--muted); max-width: 62ch; }
    .danger strong { color: var(--danger); }
    .confirmation {
      display: grid;
      grid-template-columns: 1.25rem 1fr;
      gap: 0.75rem;
      margin: 1.25rem 1.35rem 0;
      padding: 1rem;
      border: 1px solid var(--line);
      border-radius: 0.55rem;
      background: var(--surface-muted);
    }
    .confirmation input { width: 1.1rem; height: 1.1rem; margin: 0.2rem 0 0; accent-color: var(--accent); }
    .actions {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.35rem;
    }
    button {
      min-height: 2.75rem;
      padding: 0.65rem 1rem;
      border: 1px solid var(--accent);
      border-radius: 0.5rem;
      background: var(--accent);
      color: oklch(98% 0.005 155);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    button:hover { background: var(--accent-hover); }
    input:focus-visible, button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    .safe-default { color: var(--muted); font-size: 0.875rem; }
    .status {
      margin: 0 0 1rem;
      padding: 0.8rem 1rem;
      border: 1px solid currentColor;
      border-radius: 0.5rem;
    }
    .success { color: var(--success); background: var(--success-soft); }
    .error { color: var(--danger); background: var(--danger-soft); }
    @media (max-width: 36rem) {
      main { width: min(100% - 1rem, 46rem); padding-top: 2rem; }
      h1 { font-size: 1.65rem; }
      .actions { align-items: stretch; flex-direction: column; }
      button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Pipedrive MCP</p>
      <h1>Vos permissions, sans surprise</h1>
      <p class="intro">La lecture CRM reste disponible par défaut. Les capacités ci-dessous s’appliquent uniquement à votre identité Cloudflare Access.</p>
      <span class="identity">Connecté : ${escapeHtml(input.email)}</span>
    </header>
    ${status}
    <form method="post" action="/settings">
      <input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}">
      <input type="hidden" name="revision" value="${input.policy.revision}">
      <fieldset>
        <legend>Capacités optionnelles</legend>
        ${permission("writes", "Écritures CRM", "Créer et modifier des données. Chaque outil reste en simulation tant que dry_run n’est pas explicitement désactivé.", input.policy.writes)}
        ${permission("mailbox", "Lecture Mailbox", "Lire les fils et messages Pipedrive. La liaison d’un fil exige aussi les écritures CRM.", input.policy.mailbox)}
        ${permission("deletes", "Suppressions", "Autoriser les outils de suppression. Cette capacité n’a d’effet que si les écritures CRM sont également actives.", input.policy.deletes, true)}
      </fieldset>
      <label class="confirmation">
        <input type="checkbox" name="confirm" value="yes">
        <span>Je comprends que ces réglages modifient ce que Claude peut faire avec mon accès.</span>
      </label>
      <div class="actions">
        <button type="submit">Enregistrer mes permissions</button>
        <span class="safe-default">Vous pouvez revenir au mode lecture seule à tout moment.</span>
      </div>
    </form>
  </main>
</body>
</html>`;
}

function permission(
  name: string,
  title: string,
  description: string,
  checked: boolean,
  danger = false,
): string {
  return `<label class="permission${danger ? " danger" : ""}">
    <input type="checkbox" name="${name}" value="yes"${checked ? " checked" : ""}>
    <strong>${title}</strong>
    <span>${description}</span>
  </label>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
