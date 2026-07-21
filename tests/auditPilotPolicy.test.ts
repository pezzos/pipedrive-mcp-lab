import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateAlertOwnership, validatePilotEvidence, validateProductionGate } from "../scripts/lib/audit-pilot-policy.mjs";

const base = JSON.parse(readFileSync("ops/evidence/B7-live-validation.template.json", "utf8"));
const asOf = "2026-07-21T12:00:00.000Z";
const priorIncident = { ledger_receipt_hash: "b".repeat(32), ever_triggered: false };
const hash = (seed: string) => seed.repeat(32);
const expectedBinding = (evidence: any) => createHash("sha256").update(JSON.stringify({run_id:evidence.run_id,environment:evidence.environment,worker:evidence.worker,version_id:evidence.version_id,config_hash:evidence.config_hash,artifact_hash:evidence.artifact_hash})).digest("hex");
const expectedCandidateBinding = expectedBinding({run_id:"run-safe",environment:"sandbox",worker:"worker-safe",version_id:"version-safe",config_hash:hash("a"),artifact_hash:hash("b")});
const authority = (seed: string, issuedAt = "2026-07-21T10:00:00.000Z") => ({ status: "authorized", receipt_hash: hash(seed), issued_at: issuedAt, expires_at: "2026-07-22T00:00:00.000Z" });
const receipt = () => ({ pilot_customer_id_hash: hash("a"), disclosure_version: "v1", disclosure_hash: hash("b"), authorized_representative_id_hash: hash("c"), accepted_at: "2026-07-21T09:00:00.000Z", approved_channel_reference: "pilot-email-20260721", evidence_hash: hash("d"), approver: "Alexandre", expires_at: "2026-07-22T00:00:00.000Z", review_date: "2026-07-21", revoked: false });

function activePilot() {
  const evidence = structuredClone(base);
  evidence.environment = "sandbox";
  evidence.status = "in_progress";
  Object.assign(evidence,{run_id:"run-safe",worker:"worker-safe",version_id:"version-safe",config_hash:hash("a"),artifact_hash:hash("b")});
  evidence.candidate_binding_hash = expectedBinding(evidence);
  evidence.redaction_policy = "redacted-pseudonymous-evidence-only";
  Object.assign(evidence.pilot_exception, {
    status: "recorded", authorized_customer_count: 1,
    development_in_progress_disclosed: true, testing_participation_accepted: true,
    no_charge_confirmed: true, best_effort_no_24x7_no_sla_disclosed: true,
    separate_sandbox_confirmed: true, safe_expected_records_confirmed: true,
    authorized_existing_pilot_confirmed: true, pezzos_labs_scope_confirmed: true,
    tenant_isolation_validated: true, read_only_defaults_confirmed: true,
    audit_redaction_validated: true, rollback_validated: true,
    sandbox_binding_id_hash: hash("e"), audit_redaction_evidence_hash: hash("f"), rollback_evidence_hash: hash("0"),
    authorized_existing_pilot_evidence_hash: hash("1"), pezzos_labs_scope_evidence_hash: hash("2"),
    tenant_isolation_evidence_hash: hash("3"), read_only_defaults_evidence_hash: hash("4"), safe_expected_records_evidence_hash: hash("5"),
    receipt: receipt(), authorities: { SW: authority("6"), SR: authority("7"), CW: authority("8") },
    incident_state: { ever_triggered: false, active: false, containment_evidence_hash: "REDACTED_PLACEHOLDER", closed_at: "REDACTED_PLACEHOLDER", closure_evidence_hash: "REDACTED_PLACEHOLDER", fresh_authority_receipt_hash: "REDACTED_PLACEHOLDER", fresh_authority_issued_at: "REDACTED_PLACEHOLDER", ledger_receipt_hash: hash("9"), previous_state_receipt_hash: priorIncident.ledger_receipt_hash }
  });
  return evidence;
}

function activeB8() {
  const evidence = activePilot();
  evidence.status = "complete";
  evidence.live_claims = true;
  Object.assign(evidence,{run_id:"run-safe",worker:"worker-safe",version_id:"version-safe",config_hash:hash("a"),artifact_hash:hash("b")});
  evidence.timestamps.started = "2026-07-21T10:00:00.000Z";
  evidence.timestamps.completed = "2026-07-21T11:00:00.000Z";
  evidence.candidate_binding_hash=expectedBinding(evidence);
  Object.assign(evidence.immutable_export_receipt,{logpush_job_id:hash("c"),destination_id:hash("d"),first_event_id:"12345678-1234-4234-a234-123456789012",first_event_ts:"2026-07-21T10:15:00.000Z",last_event_id:"abcdef12-1234-4234-a234-123456789abc",last_event_ts:"2026-07-21T10:45:00.000Z",object_key:hash("e"),object_hash:hash("f"),object_version:hash("0"),immutability_receipt:hash("1"),candidate_binding_hash:evidence.candidate_binding_hash});
  for (const check of evidence.checks) {
    if (!check.id.startsWith("backup-")) Object.assign(check, { status: "passed", started: "2026-07-21T10:00:00.000Z", completed: "2026-07-21T11:00:00.000Z", evidence_hash: hash("a"), receipt: hash("2"), candidate_binding_hash:evidence.candidate_binding_hash, result: "passed", redaction: "redacted" });
  }
  return evidence;
}

function activeProduction() {
  const evidence = activePilot();
  evidence.environment = "production";
  evidence.candidate_binding_hash = expectedBinding(evidence);
  Object.assign(evidence.backup, { informed: true, accepted: true, access_provisioned: true, recovery_validated: true, informed_receipt_hash: hash("a"), acceptance_receipt_hash: hash("b"), least_privilege_access_receipt_hash: hash("c"), recovery_evidence_hash: hash("d"), least_privilege_scope: "production_backup_minimum", completed_at: "2026-07-21T11:00:00.000Z" });
  evidence.production_authorities = { PW: authority("e"), DW: authority("f"), CW: authority("0") };
  return evidence;
}

function historical(evidence: any, authorities: any) {
  Object.assign(evidence.pilot_exception.incident_state, { ever_triggered: true, active: false, containment_evidence_hash: hash("a"), closed_at: "2026-07-21T09:30:00.000Z", closure_evidence_hash: hash("b"), fresh_authority_receipt_hash: hash("c"), fresh_authority_issued_at: "2026-07-21T10:30:00.000Z", ledger_receipt_hash: hash("d"), previous_state_receipt_hash: priorIncident.ledger_receipt_hash });
  evidence.pilot_exception.receipt.accepted_at = "2026-07-21T10:45:00.000Z";
  for (const item of Object.values(authorities) as any[]) Object.assign(item, { receipt_hash: hash("c"), issued_at: "2026-07-21T10:30:00.000Z" });
  return evidence;
}

test("accepts valid B7, B8, B9, B10, and alerts", () => {
  const p = activePilot();
  assert.doesNotThrow(() => validatePilotEvidence(p, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(p) }));
  assert.doesNotThrow(() => validatePilotEvidence(activeB8(), { block: "B8", asOf, priorIncident, expectedCandidateBinding, customerEffect: false }));
  assert.doesNotThrow(() => validatePilotEvidence(activeB8(), { block: "B8", asOf, priorIncident, expectedCandidateBinding, customerEffect: true }));
  assert.doesNotThrow(() => validateProductionGate(activeProduction(), { block: "B9", asOf, priorIncident, expectedCandidateBinding: expectedBinding(activeProduction()) }));
  assert.doesNotThrow(() => validateProductionGate(activeProduction(), { block: "B10", asOf, priorIncident, expectedCandidateBinding: expectedBinding(activeProduction()) }));
  assert.doesNotThrow(() => validateAlertOwnership(JSON.parse(readFileSync("ops/observability/alerts.template.json", "utf8"))));
});

test("rejects invalid pilot block, owner, environment, scope, and status", () => {
  for (const mutate of [
    (x: any) => x.owner = "other", (x: any) => x.environment = "production",
    (x: any) => x.pilot_exception.scope = "other", (x: any) => x.status = "not_run"
  ]) { const x = activePilot(); mutate(x); assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
  assert.throws(() => validatePilotEvidence(activePilot(), { block: "B9", asOf, priorIncident, expectedCandidateBinding }));
});

test("rejects every B7 stop trigger", () => {
  for (const key of ["customer_billing", "additional_customer_access", "real_production_data_or_traffic", "public_availability", "security_incident"]) { const x = activePilot(); x.pilot_exception[key] = true; assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("requires every sandbox control and evidence hash", () => {
  for (const key of ["development_in_progress_disclosed", "testing_participation_accepted", "no_charge_confirmed", "best_effort_no_24x7_no_sla_disclosed", "separate_sandbox_confirmed", "safe_expected_records_confirmed", "authorized_existing_pilot_confirmed", "pezzos_labs_scope_confirmed", "tenant_isolation_validated", "read_only_defaults_confirmed", "audit_redaction_validated", "rollback_validated"]) { const x = activePilot(); x.pilot_exception[key] = false; assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
  for (const key of ["sandbox_binding_id_hash", "audit_redaction_evidence_hash", "rollback_evidence_hash", "authorized_existing_pilot_evidence_hash", "pezzos_labs_scope_evidence_hash", "tenant_isolation_evidence_hash", "read_only_defaults_evidence_hash", "safe_expected_records_evidence_hash"]) { const x = activePilot(); x.pilot_exception[key] = "REDACTED_PLACEHOLDER"; assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("rejects invalid pilot receipts", () => {
  for (const key of Object.keys(receipt())) { const x = activePilot(); delete x.pilot_exception.receipt[key]; assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
  for (const mutate of [
    (x: any) => x.pilot_exception.receipt.disclosure_hash = "hash", (x: any) => x.pilot_exception.receipt.approved_channel_reference = "!",
    (x: any) => x.pilot_exception.receipt.accepted_at = "2026-07-21T13:00:00.000Z", (x: any) => x.pilot_exception.receipt.expires_at = "2026-07-21T11:00:00.000Z",
    (x: any) => x.pilot_exception.receipt.revoked = true, (x: any) => x.pilot_exception.receipt.review_date = "2026-07-20",
    (x: any) => x.pilot_exception.receipt.review_date = "2026-07-22", (x: any) => x.pilot_exception.receipt.review_date = "2026-06-01"
  ]) { const x = activePilot(); mutate(x); assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("enforces pilot authority schemas and B8 customer effect", () => {
  const noCw = activeB8(); noCw.pilot_exception.authorities.CW = { status: "not_recorded", receipt_hash: "REDACTED_PLACEHOLDER", issued_at: "REDACTED_PLACEHOLDER", expires_at: "REDACTED_PLACEHOLDER" };
  assert.doesNotThrow(() => validatePilotEvidence(noCw, { block: "B8", asOf, priorIncident, expectedCandidateBinding, customerEffect: false }));
  assert.throws(() => validatePilotEvidence(noCw, { block: "B8", asOf, priorIncident, expectedCandidateBinding, customerEffect: true }));
  assert.throws(() => validatePilotEvidence(activeB8(), { block: "B8", asOf, priorIncident }));
  assert.throws(() => validatePilotEvidence(activePilot(), { block: "B7", asOf, priorIncident, expectedCandidateBinding, customerEffect: true }));
  for (const [block, key, effect] of [["B7", "SW", false], ["B8", "SR", false], ["B8", "CW", true]] as const) { const x = activeB8(); delete x.pilot_exception.authorities[key]; assert.throws(() => validatePilotEvidence(x, { block, asOf, priorIncident, expectedCandidateBinding, customerEffect: effect })); }
  for (const mutate of [(x: any) => delete x.pilot_exception.authorities.SW.issued_at, (x: any) => x.pilot_exception.authorities.SW.issued_at = "2026-07-21T13:00:00.000Z", (x: any) => x.pilot_exception.authorities.SW.expires_at = "2026-07-21T11:00:00.000Z"]) { const x = activePilot(); mutate(x); assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("requires complete B7 evidence for B8", () => {
  for (const mutate of [(x: any) => x.status = "in_progress", (x: any) => x.live_claims = false, (x: any) => x.timestamps.completed = "REDACTED_PLACEHOLDER", (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").status = "not_run", (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").completed = "REDACTED_PLACEHOLDER", (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").evidence_hash = "REDACTED_PLACEHOLDER", (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").receipt = "REDACTED_PLACEHOLDER", (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").result = "not_run"]) { const x = activeB8(); mutate(x); assert.throws(() => validatePilotEvidence(x, { block: "B8", asOf, priorIncident, expectedCandidateBinding, customerEffect: false })); }
});

test("rejects malformed, active, and security incident states", () => {
  for (const mutate of [(x: any) => x.pilot_exception.incident_state = {}, (x: any) => x.pilot_exception.incident_state.ledger_receipt_hash = "REDACTED_PLACEHOLDER", (x: any) => x.pilot_exception.incident_state.active = true, (x: any) => x.pilot_exception.security_incident = true]) { const x = activePilot(); mutate(x); assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("requires renewed pilot receipt and authorities after historical incident", () => {
  const valid = historical(activePilot(), activePilot().pilot_exception.authorities);
  const x = activePilot(); historical(x, x.pilot_exception.authorities); assert.doesNotThrow(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) }));
  for (const mutate of [(y: any) => y.pilot_exception.authorities.SW.issued_at = "2026-07-21T09:00:00.000Z", (y: any) => y.pilot_exception.authorities.SW.receipt_hash = hash("f"), (y: any) => y.pilot_exception.incident_state.fresh_authority_issued_at = "2026-07-21T13:00:00.000Z", (y: any) => y.pilot_exception.incident_state.closure_evidence_hash = "REDACTED_PLACEHOLDER", (y: any) => y.pilot_exception.receipt.accepted_at = "2026-07-21T09:00:00.000Z"]) { const y = structuredClone(x); mutate(y); assert.throws(() => validatePilotEvidence(y, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
  void valid;
});

test("requires production environment and exact incident state", () => {
  for (const mutate of [(x: any) => x.owner = "other", (x: any) => x.environment = "sandbox", (x: any) => delete x.pilot_exception.security_incident, (x: any) => delete x.pilot_exception.incident_state, (x: any) => x.pilot_exception.incident_state = {}, (x: any) => x.pilot_exception.incident_state.active = true, (x: any) => x.pilot_exception.security_incident = true, (x: any) => x.pilot_exception.incident_state.ever_triggered = true]) { const x = activeProduction(); mutate(x); assert.throws(() => validateProductionGate(x, { block: "B9", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("requires complete D08 identity, receipts, scope, and timing", () => {
  for (const mutate of [(x: any) => x.backup.identity = "other", (x: any) => x.backup.company = "other", (x: any) => x.backup.least_privilege_scope = "other", (x: any) => x.backup.completed_at = "2026-07-21T13:00:00.000Z"]) { const x = activeProduction(); mutate(x); assert.throws(() => validateProductionGate(x, { block: "B9", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
  for (const key of ["informed", "accepted", "access_provisioned", "recovery_validated", "informed_receipt_hash", "acceptance_receipt_hash", "least_privilege_access_receipt_hash", "recovery_evidence_hash"]) { const x = activeProduction(); if (key.endsWith("hash")) delete x.backup[key]; else x.backup[key] = false; assert.throws(() => validateProductionGate(x, { block: "B9", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("enforces production authority requirements for B9 and B10", () => {
  for (const [block, key] of [["B9", "PW"], ["B10", "PW"], ["B10", "DW"], ["B10", "CW"]] as const) { const x = activeProduction(); delete x.production_authorities[key]; assert.throws(() => validateProductionGate(x, { block, asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("requires linked post-incident production authorities", () => {
  const x = activeProduction(); historical(x, x.production_authorities);
  assert.doesNotThrow(() => validateProductionGate(x, { block: "B10", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) }));
  for (const mutate of [(y: any) => y.production_authorities.PW.issued_at = "2026-07-21T09:00:00.000Z", (y: any) => y.production_authorities.PW.receipt_hash = hash("f"), (y: any) => y.pilot_exception.incident_state.fresh_authority_issued_at = "2026-07-21T13:00:00.000Z", (y: any) => y.pilot_exception.incident_state.previous_state_receipt_hash = "REDACTED_PLACEHOLDER"]) { const y = structuredClone(x); mutate(y); assert.throws(() => validateProductionGate(y, { block: "B9", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("rejects every alert ownership deviation", () => {
  for (const [key, value] of [["owner", "other"], ["backup", "other"], ["route", "other"], ["live_status", "configured"]]) { const alerts = JSON.parse(readFileSync("ops/observability/alerts.template.json", "utf8")); alerts.alerts[0][key] = value; assert.throws(() => validateAlertOwnership(alerts)); }
});

test("requires exhaustive B7 checks when a B7 packet is complete", () => {
  const x = activeB8();
  assert.doesNotThrow(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) }));
  for (const mutate of [
    (x: any) => x.live_claims = false,
    (x: any) => x.run_id = "", (x: any) => x.worker = "bad value", (x: any) => x.version_id = "bad value",
    (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").owner = "Mallory",
    (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").receipt = "x",
    (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").redaction = "REDACTED_PLACEHOLDER",
    (x: any) => x.immutable_export_receipt.last_event_id = "not-a-uuid",
    (x: any) => x.checks.push(structuredClone(x.checks[0])),
    (x: any) => x.checks.pop(),
    (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").started = "2026-07-21T09:00:00.000Z",
    (x: any) => x.checks.find((c: any) => c.id === "tenant-isolation").completed = "2026-07-21T11:30:00.000Z"
  ]) { const x = activeB8(); mutate(x); assert.throws(() => validatePilotEvidence(x, { block: "B7", asOf, priorIncident, expectedCandidateBinding: expectedBinding(x) })); }
});

test("requires a verified prior incident head for pilot and production", () => {
  for (const prior of [undefined, { ledger_receipt_hash: hash("a"), ever_triggered: false }, { ledger_receipt_hash: hash("9"), ever_triggered: false }, { ledger_receipt_hash: priorIncident.ledger_receipt_hash, ever_triggered: true }]) {
    const pilot = activePilot();
    const production = activeProduction();
    assert.throws(() => validatePilotEvidence(pilot, { block: "B7", asOf, priorIncident: prior, expectedCandidateBinding: expectedBinding(pilot) }));
    assert.throws(() => validateProductionGate(production, { block: "B9", asOf, priorIncident: prior, expectedCandidateBinding: expectedBinding(production) }));
  }
});

test("validates read-only CLI gate arguments", () => {
  const directory = mkdtempSync(join(tmpdir(), "audit-policy-"));
  const path = join(directory, "evidence.json");
  writeFileSync(path, JSON.stringify(activePilot()));
  const args = ["scripts/validate-audit-operations.mjs", "--evidence", path, "--block", "B7", "--as-of", asOf, "--prior-incident-head", priorIncident.ledger_receipt_hash, "--prior-incident-ever-triggered", "false", "--expected-candidate-binding", expectedCandidateBinding];
  const success = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8" });
  const mismatch = spawnSync(process.execPath, [...args.slice(0, -1), "true"], { cwd: process.cwd(), encoding: "utf8" });
  const b8MissingEffect = spawnSync(process.execPath, [...args.slice(0, 4), "B8", ...args.slice(5)], { cwd: process.cwd(), encoding: "utf8" });
  rmSync(directory, { recursive: true, force: true });
  assert.equal(success.status, 0, success.stderr);
  assert.notEqual(mismatch.status, 0);
  assert.notEqual(b8MissingEffect.status, 0);
});

test("requires externally expected candidate bindings", () => {
  const pilot = activePilot();
  const savedPilotBinding = expectedBinding(pilot);
  pilot.version_id = "version-substituted";
  pilot.candidate_binding_hash = expectedBinding(pilot);
  assert.throws(() => validatePilotEvidence(pilot, { block: "B7", asOf, priorIncident, expectedCandidateBinding: savedPilotBinding }));
  assert.throws(() => validatePilotEvidence(activePilot(), { block: "B7", asOf, priorIncident }));
  const production = activeProduction();
  const savedProductionBinding = expectedBinding(production);
  production.version_id = "version-substituted";
  production.candidate_binding_hash = expectedBinding(production);
  assert.throws(() => validateProductionGate(production, { block: "B9", asOf, priorIncident, expectedCandidateBinding: savedProductionBinding }));
  assert.throws(() => validateProductionGate(activeProduction(), { block: "B9", asOf, priorIncident }));
});
