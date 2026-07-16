import type { UserConnectionStatus } from "./userConnection.js";

export type UserConnectionPageInput = {
  status: UserConnectionStatus;
  actionToken: string;
  nonce: string;
  connected: boolean;
  disconnected: boolean;
  error?: string;
};

export function renderUserConnectionPage(input: UserConnectionPageInput): string {
  const notice = input.error
    ? `<p class="notice error" role="alert">${escapeHtml(input.error)}</p>`
    : input.connected
      ? '<p class="notice success" role="status">Votre connexion Pipedrive a été enregistrée.</p>'
      : input.disconnected
        ? '<p class="notice success" role="status">Votre connexion locale a été supprimée.</p>'
        : "";
  const summary = input.status.connected
    ? `<dl><dt>Société</dt><dd>${escapeHtml(input.status.companyName)}</dd><dt>Domaine</dt><dd>${escapeHtml(input.status.domain)}.pipedrive.com</dd><dt>État</dt><dd>Connectée</dd></dl>`
    : input.status.reconnectRequired
      ? `<dl><dt>Société</dt><dd>${escapeHtml(input.status.companyName)}</dd><dt>Domaine</dt><dd>${escapeHtml(input.status.domain)}.pipedrive.com</dd><dt>État</dt><dd>Reconnexion requise</dd></dl>`
      : "<p>Aucune connexion Pipedrive n’est enregistrée pour votre compte Access.</p>";
  const connectLabel = input.status.connected ? "Remplacer la connexion" : "Connecter Pipedrive";
  const disconnect = input.status.connected
    ? `<section class="danger" aria-labelledby="disconnect-title"><h2 id="disconnect-title">Déconnecter</h2>
      <p>Supprime uniquement vos jetons locaux. Cette action ne révoque pas l’application dans Pipedrive.</p>
      <form method="post" action="/pipedrive/disconnect">
        <input type="hidden" name="csrf" value="${escapeHtml(input.actionToken)}">
        <label><input type="checkbox" name="confirm" value="yes"> Je confirme la suppression de ma connexion locale.</label>
        <button type="submit">Déconnecter mon compte</button>
      </form></section>`
    : "";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Ma connexion Pipedrive · MCP</title>
    <style nonce="${escapeHtml(input.nonce)}">
      :root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--bg:#f3f7f4;--surface:#fff;--text:#173024;--muted:#52665b;--line:#cad8cf;--accent:#167a49;--danger:#a22c2c}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.55}main{width:min(100% - 2rem,46rem);margin:auto;padding:3rem 0 5rem}h1{font-size:2rem}h2{margin-top:0}section{margin-top:1.5rem;padding:1.25rem;border:1px solid var(--line);border-radius:.75rem;background:var(--surface)}dl{display:grid;grid-template-columns:9rem 1fr}dt,dd{margin:0;padding:.5rem;border-bottom:1px solid var(--line)}dt{color:var(--muted)}input[type=text]{width:100%;min-height:2.75rem;margin:.4rem 0 1rem;padding:.65rem;border:1px solid var(--line);border-radius:.4rem}button{min-height:2.75rem;padding:.65rem 1rem;border:0;border-radius:.45rem;background:var(--accent);color:#fff;font:inherit;font-weight:700}.danger button{background:var(--danger);margin-top:1rem}.notice{padding:1rem;border-radius:.5rem}.success{background:#e4f4e9}.error{background:#fde8e8;color:#761f1f}a:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid #1769aa;outline-offset:3px}@media(max-width:34rem){main{width:min(100% - 1rem,46rem)}dl{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
    </style></head><body><main>
      <header><p>Pipedrive MCP</p><h1>Ma connexion Pipedrive</h1><p>Votre identité Access sélectionne uniquement votre propre connexion.</p></header>
      ${notice}<section aria-labelledby="status-title"><h2 id="status-title">État actuel</h2>${summary}</section>
      <section aria-labelledby="connect-title"><h2 id="connect-title">${connectLabel}</h2>
        <p>Entrez seulement le sous-domaine approuvé, par exemple <code>acme</code>.</p>
        <form method="post" action="/pipedrive/connect">
          <label for="domain">Sous-domaine Pipedrive</label>
          <input id="domain" name="domain" type="text" maxlength="63" required autocomplete="organization">
          <input type="hidden" name="csrf" value="${escapeHtml(input.actionToken)}">
          <input type="hidden" name="confirm" value="yes">
          <button type="submit">${connectLabel}</button>
        </form></section>
      ${disconnect}
      ${input.status.connected
        ? '<p><a href="/settings">Gérer mes capacités MCP</a></p>'
        : '<p>Connectez Pipedrive avant de gérer les capacités MCP de cette société.</p>'}
    </main></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
