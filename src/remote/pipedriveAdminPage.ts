import type { TenantConnectionStatus } from "./tenantSecrets.js";

export type PipedriveAdminIdentity =
  | {
      state: "available";
      companyId: string;
      companyName: string;
      companyDomain: string;
      userId: string;
      userName: string;
    }
  | { state: "unavailable" };

export type PipedriveAdminPageInput = {
  connection: TenantConnectionStatus;
  identity: PipedriveAdminIdentity;
  actionToken: string;
  nonce: string;
  connected: boolean;
  disconnected: boolean;
};

export function renderPipedriveAdminPage(input: PipedriveAdminPageInput): string {
  const notice = input.disconnected
    ? '<p class="notice success" role="status"><strong>Connexion supprimée.</strong> Les futurs appels Pipedrive du Worker sont arrêtés.</p>'
    : input.connected
      ? '<p class="notice success" role="status"><strong>Connexion enregistrée.</strong> Vérifiez la société et l’utilisateur ci-dessous.</p>'
      : "";
  const connectionState = input.connection.connected && !input.connection.materialReadable
    ? '<span class="state degraded-state"><span aria-hidden="true"></span>Connexion inutilisable</span>'
    : input.connection.connected
    ? '<span class="state connected"><span aria-hidden="true"></span>Connecté</span>'
    : '<span class="state disconnected"><span aria-hidden="true"></span>Déconnecté</span>';

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connexion Pipedrive · MCP</title>
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
      --danger-hover: oklch(42% 0.16 28);
      --danger-soft: oklch(94% 0.035 28);
      --warning: oklch(46% 0.1 75);
      --warning-soft: oklch(95% 0.035 75);
      --success: oklch(43% 0.11 150);
      --success-soft: oklch(94% 0.035 150);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--canvas); color: var(--text); font-size: 1rem; line-height: 1.55; }
    main { width: min(100% - 2rem, 48rem); margin: 0 auto; padding: 3.5rem 0 5rem; }
    header { margin-bottom: 2.25rem; }
    .eyebrow { margin: 0 0 0.5rem; color: var(--accent); font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 2rem; line-height: 1.15; letter-spacing: -0.025em; }
    h2 { margin: 0; font-size: 1.25rem; line-height: 1.3; }
    .intro { max-width: 68ch; margin: 0.9rem 0 0; color: var(--muted); }
    .notice { margin: 0 0 1.5rem; padding: 0.9rem 1rem; border: 1px solid currentColor; border-radius: 0.55rem; }
    .success { color: var(--success); background: var(--success-soft); }
    .connection { border: 1px solid var(--line); border-radius: 0.75rem; background: var(--surface); box-shadow: 0 0.8rem 2rem oklch(24% 0.018 155 / 0.07); overflow: hidden; }
    .connection-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.25rem 1.35rem; border-bottom: 1px solid var(--line); }
    .state { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; font-weight: 700; }
    .state span { width: 0.65rem; height: 0.65rem; border-radius: 50%; background: currentColor; }
    .state.connected { color: var(--success); }
    .state.degraded-state { color: var(--warning); }
    .state.disconnected { color: var(--muted); }
    dl { display: grid; grid-template-columns: minmax(9rem, 0.6fr) 1fr; margin: 0; }
    dt, dd { margin: 0; padding: 0.85rem 1.35rem; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
    dt { color: var(--muted); font-size: 0.875rem; }
    dd { font-weight: 600; }
    dl > :nth-last-child(-n + 2) { border-bottom: 0; }
    .empty { padding: 1.35rem; }
    .empty p { max-width: 65ch; margin: 0 0 1rem; color: var(--muted); }
    .degraded { margin: 0; padding: 1rem 1.35rem; border-top: 1px solid var(--warning); background: var(--warning-soft); color: var(--warning); }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 1.25rem 1.35rem; border-top: 1px solid var(--line); }
    a.button, button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; padding: 0.65rem 1rem; border: 1px solid var(--accent); border-radius: 0.5rem; background: var(--accent); color: oklch(98% 0.005 155); font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1); }
    a.button:hover, button:hover { background: var(--accent-hover); }
    a.secondary { background: transparent; color: var(--accent); }
    a.secondary:hover { background: var(--surface-muted); }
    a:focus-visible, input:focus-visible, button:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
    .danger-zone { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--line); }
    .danger-zone > p { max-width: 68ch; margin: 0.6rem 0 1rem; color: var(--muted); }
    .confirmation { display: grid; grid-template-columns: 1.25rem 1fr; gap: 0.75rem; max-width: 68ch; padding: 1rem; border: 1px solid var(--line); border-radius: 0.55rem; background: var(--surface); }
    .confirmation input { width: 1.1rem; height: 1.1rem; margin: 0.2rem 0 0; accent-color: var(--danger); }
    button.danger { margin-top: 1rem; border-color: var(--danger); background: var(--danger); }
    button.danger:hover { background: var(--danger-hover); }
    .fine-print { max-width: 68ch; margin: 0.85rem 0 0; color: var(--muted); font-size: 0.875rem; }
    @media (max-width: 36rem) {
      main { width: min(100% - 1rem, 48rem); padding-top: 2rem; }
      h1 { font-size: 1.65rem; }
      .connection-head { align-items: flex-start; flex-direction: column; }
      dl { grid-template-columns: 1fr; }
      dt { padding-bottom: 0.15rem; border-bottom: 0; }
      dd { padding-top: 0.15rem; }
      dl > :nth-last-child(-n + 2) { border-bottom: 0; }
      .actions { align-items: stretch; flex-direction: column; }
      a.button, button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Pipedrive MCP</p>
      <h1>Connexion Pipedrive</h1>
      <p class="intro">Vérifiez le compte réellement utilisé par le Worker avant de le remplacer ou de supprimer ses jetons locaux.</p>
    </header>
    ${notice}
    <section class="connection" aria-labelledby="connection-title">
      <div class="connection-head">
        <h2 id="connection-title">Compte utilisé par le Worker</h2>
        ${connectionState}
      </div>
      ${connectionDetails(input)}
    </section>
    ${disconnectForm(input)}
  </main>
</body>
</html>`;
}

function connectionDetails(input: PipedriveAdminPageInput): string {
  if (!input.connection.connected) {
    return `<div class="empty">
      <p>Aucun jeton Pipedrive n’est conservé par le Worker. Les appels MCP qui dépendent de Pipedrive échouent avec <code>pipedrive_not_connected</code>.</p>
      <a class="button" href="/admin/pipedrive/connect">Connecter Pipedrive</a>
    </div>`;
  }
  if (!input.connection.materialReadable) {
    return `<p class="degraded" role="alert"><strong>Connexion enregistrée, jetons illisibles.</strong> Le Worker ne peut pas utiliser le matériau OAuth actuel. Supprimez la connexion locale, puis reconnectez Pipedrive.</p>
    <div class="actions">
      <a class="button secondary" href="/admin/pipedrive/connect">Remplacer la connexion</a>
    </div>`;
  }
  const live = input.identity.state === "available"
    ? `<dt>Société</dt><dd>${escapeHtml(input.identity.companyName)} <span class="muted">(ID ${escapeHtml(input.identity.companyId)})</span></dd>
       <dt>Domaine société</dt><dd>${escapeHtml(input.identity.companyDomain)}</dd>
       <dt>Utilisateur</dt><dd>${escapeHtml(input.identity.userName)} <span class="muted">(ID ${escapeHtml(input.identity.userId)})</span></dd>`
    : "";
  const degraded = input.identity.state === "unavailable"
    ? '<p class="degraded" role="status"><strong>Connexion enregistrée, vérification en direct indisponible.</strong> Pipedrive n’a pas répondu avec une identité exploitable. Cela ne prouve pas une déconnexion.</p>'
    : "";
  return `<dl>
    ${live}
    <dt>Domaine API</dt><dd>${escapeHtml(input.connection.apiDomain ?? "inconnu")}</dd>
    <dt>Expiration du jeton</dt><dd>${formatDate(input.connection.expiresAtMs)}</dd>
    <dt>Connexion enregistrée</dt><dd>${formatDate(input.connection.connectedAtMs)}</dd>
  </dl>
  ${degraded}
  <div class="actions">
    <a class="button secondary" href="/admin/pipedrive/connect">Remplacer la connexion</a>
  </div>`;
}

function disconnectForm(input: PipedriveAdminPageInput): string {
  if (!input.connection.connected) {
    return "";
  }
  return `<section class="danger-zone" aria-labelledby="disconnect-title">
    <h2 id="disconnect-title">Déconnecter le Worker</h2>
    <p>Cette action supprime les jetons détenus par le Worker et arrête ses futurs appels Pipedrive.</p>
    <form method="post" action="/admin/pipedrive/disconnect">
      <input type="hidden" name="csrf" value="${escapeHtml(input.actionToken)}">
      <label class="confirmation">
        <input type="checkbox" name="confirm" value="yes">
        <span>Je confirme la suppression locale des jetons du Worker. Cette action ne désinstalle pas l’application et ne révoque pas automatiquement l’autorisation dans Pipedrive.</span>
      </label>
      <button class="danger" type="submit">Supprimer la connexion locale</button>
    </form>
    <p class="fine-print">Une requête déjà envoyée peut finir. Toute nouvelle requête après la déconnexion échouera de façon stable.</p>
  </section>`;
}

function formatDate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "inconnue";
  }
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return "inconnue";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
