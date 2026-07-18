import type {
  AdminConnectionProjection,
  TenantAdminAction,
  TenantAdminProjection,
} from "./tenantRegistry.js";

export type PipedriveAdminPageInput = {
  projection: TenantAdminProjection;
  nonce: string;
  notice?: string;
  error?: string;
};

export function renderPipedriveAdminPage(input: PipedriveAdminPageInput): string {
  const notice = input.error
    ? `<p class="notice error" role="alert">${escapeHtml(input.error)}</p>`
    : input.notice
      ? `<p class="notice success" role="status">${escapeHtml(input.notice)}</p>`
      : "";
  const tenants = input.projection.tenants.length === 0
    ? '<tr><td colspan="6">Aucun domaine Pipedrive approuvé.</td></tr>'
    : input.projection.tenants.map((tenant) => {
      const action = tenant.status === "active" ? "suspend" : "resume";
      const label = action === "suspend" ? "Suspendre" : "Reprendre";
      return `<tr><td>${escapeHtml(tenant.domain)}.pipedrive.com</td>
        <td>${escapeHtml(tenant.status)}</td>
        <td>${escapeHtml(tenant.companyName ?? "À vérifier au premier OAuth")}</td>
        <td>${escapeHtml(tenant.companyId ?? "—")}</td>
        <td>${tenant.connectedUserCount}</td>
        <td><form method="post" action="/admin/pipedrive/action/confirm">
          <input type="hidden" name="action" value="${action}">
          <input type="hidden" name="domain" value="${escapeHtml(tenant.domain)}">
          <button type="submit">${label}</button></form></td></tr>`;
    }).join("");
  const connections = input.projection.connections.length === 0
    ? "<p>Aucune connexion utilisateur indexée.</p>"
    : `<table><thead><tr><th>Email Access</th><th>Domaine</th><th>État</th><th>Connexion</th><th>Dernier usage</th><th>Action</th></tr></thead><tbody>${input.projection.connections.map((connection) =>
      connectionRow(connection),
    ).join("")}</tbody></table>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Administration Pipedrive · MCP</title>
    <style nonce="${escapeHtml(input.nonce)}">
      :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;--bg:#f3f7f4;--surface:#fff;--text:#173024;--muted:#52665b;--line:#cad8cf;--accent:#167a49;--danger:#a22c2c}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);line-height:1.5}main{width:min(100% - 2rem,72rem);margin:auto;padding:3rem 0}section{margin-top:2rem;padding:1.25rem;border:1px solid var(--line);border-radius:.7rem;background:var(--surface);overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:.65rem;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}input[type=text]{min-height:2.75rem;padding:.6rem;border:1px solid var(--line);border-radius:.4rem}button{min-height:2.5rem;padding:.55rem .8rem;border:0;border-radius:.4rem;background:var(--accent);color:#fff;font:inherit;font-weight:700}.danger{background:var(--danger)}.notice{padding:1rem;border-radius:.5rem}.success{background:#e4f4e9}.error{background:#fde8e8;color:#761f1f}a:focus-visible,input:focus-visible,button:focus-visible{outline:3px solid #1769aa;outline-offset:3px}@media(max-width:48rem){main{width:min(100% - 1rem,72rem)}}
    </style></head><body><main><header><p>Pipedrive MCP</p><h1>Administration des sociétés</h1>
      <p>Cette page gère l’admission globale. Elle n’utilise jamais le jeton Pipedrive d’un utilisateur.</p></header>
      ${notice}
      <section aria-labelledby="approve-title"><h2 id="approve-title">Approuver un domaine</h2>
        <form method="post" action="/admin/pipedrive/approve/confirm">
          <label for="domain">Sous-domaine Pipedrive</label>
          <input id="domain" name="domain" type="text" maxlength="63" required>
          <button type="submit">Préparer l’approbation</button>
        </form></section>
      <section aria-labelledby="tenants-title"><h2 id="tenants-title">Domaines approuvés</h2>
        <table><thead><tr><th>Domaine</th><th>État</th><th>Société</th><th>ID société</th><th>Utilisateurs</th><th>Action</th></tr></thead><tbody>${tenants}</tbody></table>
      </section>
      <section aria-labelledby="users-title"><h2 id="users-title">Connexions utilisateur</h2>
        <p>Les dates de dernier usage sont une projection opérationnelle et peuvent être légèrement différées.</p>
        ${connections}</section>
    </main></body></html>`;
}

export function renderApproveConfirmation(input: {
  domain: string;
  actionToken: string;
  nonce: string;
}): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmer l’approbation</title>
  <style nonce="${escapeHtml(input.nonce)}">body{font:1rem/1.5 system-ui;margin:3rem;max-width:44rem}button{padding:.7rem 1rem}button:focus-visible{outline:3px solid #1769aa;outline-offset:3px}</style></head><body>
  <main><h1>Confirmer l’approbation</h1><p>Le domaine <strong>${escapeHtml(input.domain)}.pipedrive.com</strong> pourra recevoir des connexions OAuth individuelles. Cette action n’ajoute aucun utilisateur à Cloudflare Access.</p>
  <form method="post" action="/admin/pipedrive/tenant"><input type="hidden" name="action" value="approve"><input type="hidden" name="domain" value="${escapeHtml(input.domain)}"><input type="hidden" name="csrf" value="${escapeHtml(input.actionToken)}"><input type="hidden" name="confirm" value="yes"><button type="submit">Confirmer l’approbation</button></form></main></body></html>`;
}

export function renderAdminActionConfirmation(input: {
  action: Exclude<TenantAdminAction, "approve">;
  target: string;
  actionToken: string;
  nonce: string;
}): string {
  const isForceDisconnect = input.action === "force-disconnect";
  const label = isForceDisconnect
    ? "Forcer la déconnexion de cette connexion"
    : input.action === "suspend"
      ? `Suspendre ${input.target}.pipedrive.com`
      : `Reprendre ${input.target}.pipedrive.com`;
  const route = isForceDisconnect
    ? "/admin/pipedrive/force-disconnect"
    : "/admin/pipedrive/tenant";
  const targetField = isForceDisconnect ? "connection_ref" : "domain";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirmer l’action</title>
  <style nonce="${escapeHtml(input.nonce)}">body{font:1rem/1.5 system-ui;margin:3rem;max-width:44rem}button{padding:.7rem 1rem}button:focus-visible{outline:3px solid #1769aa;outline-offset:3px}</style></head><body>
  <main><h1>Confirmer l’action</h1><p>${escapeHtml(label)}</p>
  <form method="post" action="${route}"><input type="hidden" name="action" value="${escapeHtml(input.action)}"><input type="hidden" name="${targetField}" value="${escapeHtml(input.target)}"><input type="hidden" name="csrf" value="${escapeHtml(input.actionToken)}"><input type="hidden" name="confirm" value="yes"><button type="submit">Confirmer</button></form></main></body></html>`;
}

function connectionRow(connection: AdminConnectionProjection): string {
  return `<tr><td>${escapeHtml(connection.accessEmail)}</td><td>${escapeHtml(connection.domain)}</td>
    <td>${escapeHtml(connection.state)}</td><td>${formatDate(connection.connectedAtMs)}</td>
    <td>${formatDate(connection.lastUsedAtMs)}</td><td><form method="post" action="/admin/pipedrive/action/confirm">
    <input type="hidden" name="action" value="force-disconnect">
    <input type="hidden" name="connection_ref" value="${escapeHtml(connection.connectionRef)}">
    <button class="danger" type="submit">Forcer la déconnexion</button></form></td></tr>`;
}

function formatDate(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  } catch {
    return "—";
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
