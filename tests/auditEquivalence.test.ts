import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateAuditEventV3 } from "../src/remote/audit.js";
import { readAuditNdjson } from "../scripts/lib/audit-operations.mjs";
import { clone, invalidAuditMutations, validAuditRepresentatives } from "../scripts/lib/audit-equivalence-fixtures.mjs";

const schema = JSON.parse(readFileSync("ops/audit/audit-event-v3.schema.json", "utf8"));
// Conditional branches reference root properties; retain all strict checks except local strictRequired.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const schemaValidate = ajv.compile(schema);

test("runtime, offline parser, and Draft 2020 schema classify complete audit fixtures equivalently", async () => {
  const root = mkdtempSync(join(tmpdir(), "audit-equivalence-"));
  try {
    for (const fixture of validAuditRepresentatives) {
      const value = clone(fixture.value);
      assert.doesNotThrow(() => validateAuditEventV3(value, fixture.name.startsWith("config-")), fixture.name);
      assert.equal(schemaValidate(value), true, fixture.name);
      const path = join(root, `${fixture.name}.ndjson`); writeFileSync(path, `${JSON.stringify(value)}\n`);
      assert.equal((await readAuditNdjson(path)).records.length, 1, fixture.name);
    }
    for (const [name, mutate] of invalidAuditMutations) {
      const value = clone(validAuditRepresentatives[0].value); mutate(value);
      assert.throws(() => validateAuditEventV3(value), name);
      assert.equal(schemaValidate(value), false, name);
      const path = join(root, `${name}.ndjson`); writeFileSync(path, `${JSON.stringify(value)}\n`);
      assert.equal((await readAuditNdjson(path)).invalid, 1, name);
    }
    const byteLimited = { ...clone(validAuditRepresentatives[0].value), worker: "w".repeat(128), versionId: "v".repeat(128), versionTag: "t".repeat(128), requestId: "r".repeat(128), auditEpoch: "e".repeat(128), operation: "o".repeat(128), tenantId: "n".repeat(128), errorCode: "c".repeat(128), previousActorId: "a".repeat(32), previousAuditEpoch: "p".repeat(128), targetIds: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${"a".repeat(60)}${i}_id`, "x".repeat(128)])), measurements: { request_count: 1, cpu_ms: 1, storage_bytes: 1, provider_cost_eur_micros: 1, queue_depth: 1, freshness_seconds: 1, parse_failures: 1, capacity_percent: 1, purge_delay_seconds: 1 }, policyChanges: { writes: { from: true, to: false }, deletes: { from: true, to: false }, mailbox: { from: true, to: false } } };
    assert.ok(Buffer.byteLength(JSON.stringify(byteLimited)) > 4096);
    assert.equal(schemaValidate(byteLimited), true, "byte limit is an explicit non-schema guard");
    assert.throws(() => validateAuditEventV3(byteLimited));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
