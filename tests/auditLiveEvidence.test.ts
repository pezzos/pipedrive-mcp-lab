import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasRawLiveMaterial, validateLiveCutoverEvidence, verifyReceiptHash } from "../scripts/lib/audit-live-evidence.mjs";

const receiptPath = "ops/evidence/B7-live-cutover-2026-07-22.json";
const loadReceipt = () => JSON.parse(readFileSync(receiptPath, "utf8"));
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
