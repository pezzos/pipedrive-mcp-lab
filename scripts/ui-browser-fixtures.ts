import { createServer } from "node:http";
import { renderUserConnectionPage } from "../src/remote/userConnectionPage.js";
import { renderSettingsPage } from "../src/remote/settingsPage.js";
import { renderPipedriveAdminPage, renderApproveConfirmation, renderAdminActionConfirmation } from "../src/remote/pipedriveAdminPage.js";
import { htmlResponse } from "../src/remote/pageResponse.js";

const nonce = "fixture-nonce";
const domain = "a".repeat(63);
const email = `${"u".repeat(308)}@example.invalid`;
const company = "S".repeat(160);
const scenarios = new Set(["disconnected", "connected", "reconnect", "replacement", "admission", "company-mismatch", "oauth-cancelled", "oauth-error", "conflict", "storage", "settings-readonly", "settings-mixed", "settings-error", "admin-empty", "admin-typical", "admin-suspended", "admin-reconnect", "confirm-approve", "confirm-suspend", "confirm-resume", "confirm-force", "ticket-error", "density"]);
function body(scenario: string): string {
  if (scenario.startsWith("settings")) return renderSettingsPage({ email, csrf: "fixture-token", nonce, saved: false, error: scenario === "settings-error" ? "Conflit de révision, rechargez la page." : undefined, company, domain, policy: { writes: scenario === "settings-mixed", deletes: false, mailbox: scenario === "settings-mixed", revision: 2, updatedAt: "2026-07-21T00:00:00.000Z" } });
  if (scenario.startsWith("confirm")) {
    if (scenario === "confirm-approve") return renderApproveConfirmation({ domain, actionToken: "fixture-token", nonce });
    return renderAdminActionConfirmation({ action: scenario === "confirm-force" ? "force-disconnect" : scenario === "confirm-suspend" ? "suspend" : "resume", target: domain, actionToken: "fixture-token", nonce, ...(scenario === "confirm-force" ? { forceTarget: { connectionRef: "opaque-ref", accessEmail: email, domain, state: "connected", connectedAtMs: 0 } } : {}) });
  }
  if (scenario.startsWith("admin") || scenario === "ticket-error" || scenario === "density") {
    const connections = scenario === "admin-empty" ? [] : Array.from({ length: scenario === "density" ? 500 : 1 }, (_, i) => ({ connectionRef: `opaque-${i}`, accessEmail: email, domain, state: scenario === "admin-reconnect" ? "reconnect-required" as const : "connected" as const, generation: 1, connectedAtMs: 0, tokenExpiresAtMs: 1 }));
    const tenants = scenario === "admin-empty" ? [] : Array.from({ length: scenario === "density" ? 200 : 1 }, (_, i) => ({ domain: scenario === "density" ? `tenant-${String(i).padStart(3, "0")}` : domain, status: scenario === "admin-suspended" ? "suspended" as const : "active" as const, tenantId: `tenant-${i}`, generation: 1, createdAtMs: 0, updatedAtMs: 1, companyName: company, companyId: `company-${i}`, connectedUserCount: connections.length }));
    return renderPipedriveAdminPage({ nonce, error: scenario === "ticket-error" ? "ticket" : undefined, projection: { tenants, connections } });
  }
  const connected = scenario === "connected" || scenario === "replacement";
  return renderUserConnectionPage({ nonce, actionToken: "fixture-token", notice: scenario === "oauth-cancelled" ? "oauth-cancelled" : scenario === "admission" ? "admission" : scenario === "company-mismatch" ? "company-mismatch" : scenario === "storage" ? "storage" : scenario === "conflict" ? "conflict" : scenario === "oauth-error" ? "oauth-error" : undefined, status: connected ? { connected: true, reconnectRequired: false, generation: 1, domain, companyId: "company-id", companyName: company, expiresAtMs: 1, connectedAtMs: 0, lastUsedAtMs: 0 } : scenario === "reconnect" ? { connected: false, reconnectRequired: true, generation: 1, domain, companyId: "company-id", companyName: company, connectedAtMs: 0, purgedAtMs: 1 } : { connected: false, reconnectRequired: false, generation: 0 } });
}
createServer(async (request, response) => {
  const scenario = new URL(request.url ?? "/", "http://fixture.invalid").pathname.slice(1) || "disconnected";
  if (!scenarios.has(scenario)) { response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); response.end("Not found"); return; }
  const rendered = htmlResponse(body(scenario), 200, nonce);
  response.writeHead(rendered.status, Object.fromEntries(rendered.headers)); response.end(await rendered.text());
}).listen(4173, "127.0.0.1");
