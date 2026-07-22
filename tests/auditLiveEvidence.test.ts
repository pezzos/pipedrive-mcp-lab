import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasRawLiveMaterial, validateAlertEmailAckEvidence, validateB7LiveAuthorityEvidence, validateB7SandboxValidationObservationEvidence, validateLiveCutoverEvidence, verifyReceiptHash } from "../scripts/lib/audit-live-evidence.mjs";

const receiptPath = "ops/evidence/B7-live-cutover-2026-07-22.json";
const alertAckReceiptPath = "ops/evidence/B7-alert-email-ack-2026-07-22.json";
const srAuthorityPath = "ops/evidence/B7-sr-authority-2026-07-22.json";
const swAuthorityPath = "ops/evidence/B7-sw-validation-authority-2026-07-22.json";
const validationObservationPath = "ops/evidence/B7-sandbox-validation-observation-2026-07-22.json";
const loadReceipt = () => JSON.parse(readFileSync(receiptPath, "utf8"));
const loadAlertAckReceipt = () => JSON.parse(readFileSync(alertAckReceiptPath, "utf8"));
const loadAuthority = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const rehash = (receipt: Record<string, unknown>) => {
  const { receipt_hash: _receiptHash, ...body } = receipt;
  receipt.receipt_hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return receipt;
};

test("B7 live cutover receipt is hash-verified and exact", () => {
  const receipt = loadReceipt();
  assert.equal(verifyReceiptHash(receipt), true);
  assert.equal(hasRawLiveMaterial(receipt), false);
  assert.equal(validateLiveCutoverEvidence(receipt), receipt);
});

test("B7 live cutover receipt rejects changed delivery facts even with a replacement hash", () => {
  const receipt = structuredClone(loadReceipt());
  receipt.delivery.cadence_seconds = 301;
  assert.throws(() => validateLiveCutoverEvidence(rehash(receipt)), /delivery/);
});

test("B7 live cutover receipt rejects a malformed authority scope and non-fresh final gate", () => {
  const authorityReceipt = structuredClone(loadReceipt());
  authorityReceipt.authority.authority_scope.r2_object_delete = true;
  assert.throws(() => validateLiveCutoverEvidence(rehash(authorityReceipt)), /authority_scope/);
  const gateReceipt = structuredClone(loadReceipt());
  gateReceipt.verification.sequential_total = 228;
  assert.throws(() => validateLiveCutoverEvidence(rehash(gateReceipt)), /verification/);
});

test("B7 live cutover receipt rejects non-pending alert, D08, or stop-trigger states", () => {
  const alertReceipt = structuredClone(loadReceipt());
  alertReceipt.alert_test.email_receipt_pending = false;
  assert.throws(() => validateLiveCutoverEvidence(rehash(alertReceipt)), /alert_test/);
  const d08Receipt = structuredClone(loadReceipt());
  d08Receipt.d08.status = "activated";
  assert.throws(() => validateLiveCutoverEvidence(rehash(d08Receipt)), /d08/);
  const triggerReceipt = structuredClone(loadReceipt());
  triggerReceipt.stop_triggers.public_availability = true;
  assert.throws(() => validateLiveCutoverEvidence(rehash(triggerReceipt)), /stop_triggers/);
  const statusReceipt = structuredClone(loadReceipt());
  statusReceipt.b7_status = "completed";
  assert.throws(() => validateLiveCutoverEvidence(rehash(statusReceipt)), /metadata/);
});

test("B7 live cutover receipt rejects raw identifiers and a stale self-hash", () => {
  const rawReceipt = structuredClone(loadReceipt());
  rawReceipt.r2.bucket = "private-audit-bucket";
  assert.throws(() => validateLiveCutoverEvidence(rehash(rawReceipt)), /raw_material/);
  const staleReceipt = structuredClone(loadReceipt());
  staleReceipt.logpush.new_enabled = false;
  assert.throws(() => validateLiveCutoverEvidence(staleReceipt), /self_hash/);
});

test("B7 live cutover receipt rejects duplicate object hashes and a removed reader boundary", () => {
  const duplicateReceipt = structuredClone(loadReceipt());
  duplicateReceipt.delivery.object_key_hashes[4] = duplicateReceipt.delivery.object_key_hashes[0];
  assert.throws(() => validateLiveCutoverEvidence(rehash(duplicateReceipt)), /delivery/);
  const readerReceipt = structuredClone(loadReceipt());
  readerReceipt.unproven = readerReceipt.unproven.filter((value: string) => value !== "read_access_alexandre_only");
  assert.throws(() => validateLiveCutoverEvidence(rehash(readerReceipt)), /unproven/);
});

test("B7 live cutover receipt requires receipt_hash to be the final field", () => {
  const receipt = loadReceipt();
  const { receipt_hash, ...body } = receipt;
  const reordered = { receipt_hash, ...body };
  assert.throws(() => validateLiveCutoverEvidence(reordered), /top_level_keys/);
});

test("B7 alert email acknowledgement receipt is exact, linked, and hash-verified", () => {
  const predecessor = loadReceipt(), receipt = loadAlertAckReceipt();
  assert.equal(verifyReceiptHash(receipt), true);
  assert.equal(hasRawLiveMaterial(receipt), false);
  assert.equal(validateAlertEmailAckEvidence(receipt, predecessor), receipt);
});

test("B7 alert acknowledgement rejects a changed predecessor, predecessor hash, and recipient link", () => {
  const predecessor = loadReceipt();
  const changedPredecessor = structuredClone(predecessor);
  changedPredecessor.alert_test.email_receipt_pending = false;
  assert.throws(() => validateAlertEmailAckEvidence(loadAlertAckReceipt(), changedPredecessor), /self_hash/);
  const predecessorReceipt = structuredClone(loadAlertAckReceipt());
  predecessorReceipt.predecessor_receipt_hash = "0".repeat(64);
  assert.throws(() => validateAlertEmailAckEvidence(rehash(predecessorReceipt), predecessor), /alert_ack_predecessor/);
  const recipientReceipt = structuredClone(loadAlertAckReceipt());
  recipientReceipt.email_receipt.recipient_identity_hash = "0".repeat(64);
  assert.throws(() => validateAlertEmailAckEvidence(rehash(recipientReceipt), predecessor), /alert_ack_email_receipt/);
});

test("B7 alert acknowledgement rejects mail identity, domain, temporal, and raw-material deviations", () => {
  const predecessor = loadReceipt();
  for (const mutate of [
    (receipt: any) => receipt.email_receipt.sender_hash = "0".repeat(64),
    (receipt: any) => receipt.email_receipt.subject_hash = "0".repeat(64),
    (receipt: any) => receipt.email_receipt.signed_domain = "invalid.example",
    (receipt: any) => receipt.email_receipt.gmail_signed_by_domain_observed = false,
    (receipt: any) => receipt.email_receipt.receipt_minute_local = "2026-07-22T13:16:00+02:00",
    (receipt: any) => receipt.email_receipt.temporal_binding.receipt_interval_start = "2026-07-22T11:16:00.000Z",
    (receipt: any) => receipt.email_receipt.temporal_binding.second_order_claimed = true
  ]) { const receipt = structuredClone(loadAlertAckReceipt()); mutate(receipt); assert.throws(() => validateAlertEmailAckEvidence(rehash(receipt), predecessor), /alert_ack_email_receipt/); }
  const rawReceipt = structuredClone(loadAlertAckReceipt());
  rawReceipt.email_receipt.header = "recipient@example.test";
  assert.throws(() => validateAlertEmailAckEvidence(rehash(rawReceipt), predecessor), /alert_ack_raw_material/);
  const rawAppshotReceipt = structuredClone(loadAlertAckReceipt());
  rawAppshotReceipt.source.appshot = "raw-image-content";
  assert.throws(() => validateAlertEmailAckEvidence(rehash(rawAppshotReceipt), predecessor), /alert_ack_raw_material/);
  const rawMessageReceipt = structuredClone(loadAlertAckReceipt());
  rawMessageReceipt.email_receipt.message = "raw mail body";
  assert.throws(() => validateAlertEmailAckEvidence(rehash(rawMessageReceipt), predecessor), /alert_ack_raw_material/);
});

test("B7 alert acknowledgement rejects fixture overclaim, transition, and unsafe B7 state", () => {
  const predecessor = loadReceipt();
  const fixtureReceipt = structuredClone(loadAlertAckReceipt());
  fixtureReceipt.fixture.actual_live_job_failure = true;
  assert.throws(() => validateAlertEmailAckEvidence(rehash(fixtureReceipt), predecessor), /alert_ack_fixture/);
  const fixtureReferenceReceipt = structuredClone(loadAlertAckReceipt());
  fixtureReferenceReceipt.fixture.live_job_or_destination_referenced = true;
  assert.throws(() => validateAlertEmailAckEvidence(rehash(fixtureReferenceReceipt), predecessor), /alert_ack_fixture/);
  for (const key of ["fixture_job_hash", "fixture_destination_hash"]) { const receipt = structuredClone(loadAlertAckReceipt()); receipt.fixture[key] = "0".repeat(64); assert.throws(() => validateAlertEmailAckEvidence(rehash(receipt), predecessor), /alert_ack_fixture/); }
  const transitionReceipt = structuredClone(loadAlertAckReceipt());
  transitionReceipt.state_transition.current_blockers = ["remaining_non_backup_live_checks"];
  assert.throws(() => validateAlertEmailAckEvidence(rehash(transitionReceipt), predecessor), /alert_ack_state_transition/);
  const closedBlockerReceipt = structuredClone(loadAlertAckReceipt());
  closedBlockerReceipt.state_transition.closed_blocker = "remaining_non_backup_live_checks";
  assert.throws(() => validateAlertEmailAckEvidence(rehash(closedBlockerReceipt), predecessor), /alert_ack_state_transition/);
  const b7Receipt = structuredClone(loadAlertAckReceipt());
  b7Receipt.b7_status = "completed";
  assert.throws(() => validateAlertEmailAckEvidence(rehash(b7Receipt), predecessor), /alert_ack_metadata/);
});

test("B7 alert acknowledgement rejects invalid acknowledgement, D08, stop triggers, and reader overclaim", () => {
  const predecessor = loadReceipt();
  for (const mutate of [
    (receipt: any) => receipt.operator_acknowledgement.actor_identity_hash = "0".repeat(64),
    (receipt: any) => receipt.operator_acknowledgement.method = "other",
    (receipt: any) => receipt.operator_acknowledgement.acknowledged_at = "2026-07-22T11:15:00Z",
    (receipt: any) => receipt.operator_acknowledgement.authorizes_further_live_effects = true,
    (receipt: any) => delete receipt.operator_acknowledgement.actor_identity_hash
  ]) { const receipt = structuredClone(loadAlertAckReceipt()); mutate(receipt); assert.throws(() => validateAlertEmailAckEvidence(rehash(receipt), predecessor), /alert_ack_operator_acknowledgement/); }
  const d08Receipt = structuredClone(loadAlertAckReceipt());
  d08Receipt.d08.status = "active";
  assert.throws(() => validateAlertEmailAckEvidence(rehash(d08Receipt), predecessor), /alert_ack_d08/);
  for (const key of Object.keys(loadAlertAckReceipt().stop_triggers)) { const receipt = structuredClone(loadAlertAckReceipt()); receipt.stop_triggers[key] = true; assert.throws(() => validateAlertEmailAckEvidence(rehash(receipt), predecessor), /alert_ack_stop_triggers/); }
  const readerReceipt = structuredClone(loadAlertAckReceipt());
  readerReceipt.reader_boundary.read_access_alexandre_only_proven = true;
  assert.throws(() => validateAlertEmailAckEvidence(rehash(readerReceipt), predecessor), /alert_ack_reader_boundary/);
});

test("B7 SR and SW authorities are exact, distinct, and receipt-bound", () => {
  const cutover = loadReceipt(), ack = loadAlertAckReceipt(), sr = loadAuthority(srAuthorityPath), sw = loadAuthority(swAuthorityPath);
  assert.equal(validateB7LiveAuthorityEvidence(sr, "SR", cutover, ack), sr);
  assert.equal(validateB7LiveAuthorityEvidence(sw, "SW", cutover, ack), sw);
  assert.notEqual(sr.receipt_hash, sw.receipt_hash);
});

test("B7 authorities reject widened scopes, excluded activity, and unsafe controls", () => {
  const cutover = loadReceipt(), ack = loadAlertAckReceipt();
  for (const mutate of [(receipt: any) => receipt.scope.push("Pipedrive_read"), (receipt: any) => receipt.exclusions = receipt.exclusions.filter((value: string) => value !== "public_route"), (receipt: any) => receipt.exclusions = receipt.exclusions.filter((value: string) => value !== "designated_D08_backup"), (receipt: any) => receipt.exclusions = receipt.exclusions.filter((value: string) => value !== "object_job_bucket_worker_tenant_deletion"), (receipt: any) => receipt.cost_controls.expected_incremental_charge_eur = 1, (receipt: any) => receipt.stop_triggers.security_incident = true, (receipt: any) => receipt.live_effects_performed = true, (receipt: any) => receipt.expires_at = receipt.issued_at, (receipt: any) => receipt.targets.worker_hash = "0".repeat(64)]) { const receipt = structuredClone(loadAuthority(swAuthorityPath)); mutate(receipt); assert.throws(() => validateB7LiveAuthorityEvidence(rehash(receipt), "SW", cutover, ack)); }
  const rawReceipt = structuredClone(loadAuthority(srAuthorityPath)); rawReceipt.source.message = "person@example.test";
  assert.throws(() => validateB7LiveAuthorityEvidence(rehash(rawReceipt), "SR", cutover, ack), /authority_hash_or_raw/);
  for (const value of ["Alexandre", "Davy"]) { const receipt = structuredClone(loadAuthority(swAuthorityPath)); receipt.scope.push(value); assert.throws(() => validateB7LiveAuthorityEvidence(rehash(receipt), "SW", cutover, ack), /authority_hash_or_raw/); }
});

test("B7 sandbox observation is partial, hash-bound, and records the reader-boundary failure", () => {
  const cutover=loadReceipt(),alertAck=loadAlertAckReceipt(),srAuthority=loadAuthority(srAuthorityPath),swAuthority=loadAuthority(swAuthorityPath),observation=loadAuthority(validationObservationPath);
  assert.equal(validateB7SandboxValidationObservationEvidence(observation,{cutover,alertAck,srAuthority,swAuthority}),observation);
  assert.equal(observation.inventory.account_access.read_access_operator_only,false);
  assert.equal(observation.inventory.logpush.freshness_check,"failed");
  assert.equal(observation.finding.acceptance_blocking,true);
  assert.equal(observation.validation_summary.exhaustive_26_check_packet_completed,false);
});

test("B7 sandbox observation rejects a softened finding, widened effect, or raw identity", () => {
  const cutover=loadReceipt(),alertAck=loadAlertAckReceipt(),srAuthority=loadAuthority(srAuthorityPath),swAuthority=loadAuthority(swAuthorityPath);
  const validate=(observation:any)=>validateB7SandboxValidationObservationEvidence(rehash(observation),{cutover,alertAck,srAuthority,swAuthority});
  for(const mutate of [(o:any)=>o.inventory.account_access.read_access_operator_only=true,(o:any)=>o.inventory.logpush.freshness_check="passed",(o:any)=>o.finding.acceptance_blocking=false,(o:any)=>o.validation_summary.exhaustive_26_check_packet_completed=true,(o:any)=>o.live_effects[0].accepted_logpush_job_mutated=true,(o:any)=>o.stop_triggers.public_availability=true,(o:any)=>o.negative_effect_facts.secret_rotated_or_exposed=true]){const observation=structuredClone(loadAuthority(validationObservationPath));mutate(observation);assert.throws(()=>validate(observation));}
  const raw=structuredClone(loadAuthority(validationObservationPath));raw.inventory.account_access.message="person@example.test";assert.throws(()=>validate(raw),/validation_observation_hash_or_raw/);
});
