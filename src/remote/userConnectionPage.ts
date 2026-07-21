import { escapeHtml, renderPageShell } from "./pageShell.js";
import type { UserConnectionStatus } from "./userConnection.js";

export type UserConnectionNotice = "connected" | "disconnected" | "not-connected" | "reconnect" | "admission" | "company-mismatch" | "oauth-cancelled" | "oauth-error" | "conflict" | "csrf" | "storage";
export type UserConnectionPageInput = { status: UserConnectionStatus; actionToken: string; nonce: string; notice?: UserConnectionNotice };

const notices: Record<UserConnectionNotice, { tone: "success" | "warning" | "error"; text: string }> = {
  connected: { tone: "success", text: "Votre connexion Pipedrive a été vérifiée et enregistrée." },
  disconnected: { tone: "success", text: "Vos jetons OAuth locaux ont été supprimés." },
  "not-connected": { tone: "warning", text: "Connectez Pipedrive avant de gérer les permissions." },
  reconnect: { tone: "warning", text: "Votre connexion doit être renouvelée avant de gérer les permissions." },
  admission: { tone: "warning", text: "Ce domaine ne peut pas être connecté. Vérifiez-le avec l’administrateur de la plateforme." },
  "company-mismatch": { tone: "warning", text: "La société retournée ne correspond pas au domaine approuvé. Votre connexion existante reste inchangée." },
  "oauth-cancelled": { tone: "warning", text: "L’autorisation Pipedrive a été annulée. Votre connexion existante reste inchangée." },
  "oauth-error": { tone: "error", text: "La vérification OAuth n’a pas abouti. Votre connexion existante reste inchangée." },
  conflict: { tone: "warning", text: "La connexion a changé pendant la vérification. Rechargez cette page avant de réessayer." },
  csrf: { tone: "warning", text: "Cette confirmation a expiré ou a déjà été utilisée. Rechargez la page." },
  storage: { tone: "error", text: "Le stockage sécurisé est momentanément indisponible. Réessayez plus tard." },
};

export function renderUserConnectionPage(input: UserConnectionPageInput): string {
  const statusValue = input.status;
  const hasConnection = statusValue.connected || statusValue.reconnectRequired;
  const notice = input.notice ? `<p class="notice ${notices[input.notice].tone}" ${notices[input.notice].tone === "error" ? 'role="alert"' : 'role="status"'}>${notices[input.notice].text}</p>` : "";
  const state = statusValue.connected ? "Connectée" : statusValue.reconnectRequired ? "Reconnexion requise" : "Non connectée";
  const company = statusValue.connected || statusValue.reconnectRequired ? `<dl><dt>Société</dt><dd>${escapeHtml(statusValue.companyName)}</dd><dt>Domaine</dt><dd>${escapeHtml(statusValue.domain)}.pipedrive.com</dd><dt>État</dt><dd>${state}</dd><dt>Connectée</dt><dd>${date(statusValue.connectedAtMs)}</dd><dt>Dernier usage</dt><dd>${date(statusValue.lastUsedAtMs)}</dd>${statusValue.connected ? `<dt>Expiration</dt><dd>${date(statusValue.expiresAtMs)}</dd>` : `<dt>Jetons purgés</dt><dd>${date(statusValue.purgedAtMs)}</dd>`}<dt>Prochaine étape</dt><dd>${statusValue.reconnectRequired ? "Reconnectez Pipedrive pour retrouver un accès lecture." : "Vous pouvez gérer les permissions lecture seule."}</dd></dl>` : "<p>Aucune connexion Pipedrive n’est enregistrée pour votre identité Access. Connectez une société approuvée pour commencer en lecture seule.</p>";
  const replacing = input.status.connected ? "Remplacer la connexion" : input.status.reconnectRequired ? "Reconnecter Pipedrive" : "Connecter Pipedrive";
  const localDisconnect = input.status.connected
    ? `<section aria-labelledby="replacement-title"><h2 id="replacement-title">Avant de remplacer</h2><p>Votre connexion actuelle reste active jusqu’à la validation complète de la nouvelle société. Une nouvelle société démarre toujours en lecture seule.</p></section><section class="danger" aria-labelledby="disconnect-title"><h2 id="disconnect-title">Déconnecter localement</h2><p>Supprime seulement les jetons conservés par le Worker. Cela ne révoque pas l’application Pipedrive dans ChatGPT, votre accès, ni l’autorisation accordée au fournisseur.</p><form method="post" action="/pipedrive/disconnect"><input type="hidden" name="csrf" value="${escapeHtml(input.actionToken)}"><label class="checkbox-row"><input type="checkbox" name="confirm" value="yes" required>Je confirme la suppression de mes jetons OAuth locaux.</label><div class="actions"><button class="button-danger" type="submit">Déconnecter mon compte local</button><a href="/pipedrive">Annuler</a></div></form></section><p><a href="/settings">Gérer mes permissions</a></p>`
    : '<p><a href="/pipedrive">Annuler et revenir à l’état de connexion</a></p>';
  const connectConfirmation = input.status.connected ? `<p class="panel"><strong>Conséquence du remplacement</strong><br>Votre connexion actuelle reste active jusqu’à la validation complète de la nouvelle société. Cette nouvelle société commencera en lecture seule.</p><label class="checkbox-row"><input type="checkbox" name="confirm" value="yes" required>Je confirme le remplacement après vérification complète.</label>` : '<input type="hidden" name="confirm" value="yes">';
  const children = `<nav aria-label="Navigation"><a href="/pipedrive" aria-current="page">Connexion</a><a href="/settings">Permissions</a></nav><header><p class="eyebrow">Pipedrive MCP</p><h1>Ma connexion Pipedrive</h1><p class="intro">Connectez votre propre société Pipedrive. Votre identité Access sélectionne uniquement votre connexion, jamais celle d’un autre utilisateur.</p></header>${notice}<section aria-labelledby="journey-title"><h2 id="journey-title">Parcours sûr</h2><ol><li>Connectez votre société Pipedrive approuvée.</li><li>Vérifiez la société retournée après OAuth.</li><li>Relisez vos permissions, lecture seule par défaut.</li><li>Retournez dans l’application Pipedrive pour une lecture sûre.</li></ol></section><section aria-labelledby="state-title"><h2 id="state-title">État actuel</h2>${company}</section><section aria-labelledby="connect-title"><h2 id="connect-title">${replacing}</h2><p>Entrez uniquement le sous-domaine approuvé, par exemple <code>acme</code>.</p><form method="post" action="/pipedrive/connect"><label for="domain">Sous-domaine Pipedrive</label><input id="domain" name="domain" type="text" maxlength="63" required autocomplete="organization"><input type="hidden" name="csrf" value="${escapeHtml(input.actionToken)}">${connectConfirmation}<button type="submit">${replacing}</button></form></section>${localDisconnect}`;
  return renderPageShell({ title: "Connexion Pipedrive · MCP", nonce: input.nonce, children });
}

function date(value: number | undefined): string { if (value === undefined || !Number.isFinite(value)) return "—"; const current = new Date(value); return `<time datetime="${current.toISOString()}">${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(current)}</time>`; }
