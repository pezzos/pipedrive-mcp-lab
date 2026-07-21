import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { requiredClientArtifactRecord } from "../scripts/worker-release-client.mjs";

test("fresh client distribution is rejected until artifact, receipt, and receipt tree exist", () => {
  const root = mkdtempSync(join(tmpdir(), "pipedrive-worker-release-client-"));
  try {
    const source = join(root, "plugin", "chatgpt");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "plugin-source.json"), "{\"mcp_url\":\"https://pipedrive-mcp-sandbox.pezzoslabs.com/mcp\"}\n");
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_artifact_missing/);

    const artifact = join(root, "dist", "chatgpt-plugin", "pipedrive-sandbox-0.3.4");
    mkdirSync(artifact, { recursive: true });
    writeFileSync(join(artifact, "plugin.json"), "{}\n");
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_receipt_missing/);

    const receipt = join(root, "dist", "chatgpt-plugin", "pipedrive-sandbox-0.3.4.sha256.json");
    writeFileSync(receipt, "{}\n");
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_receipt_format_invalid/);

    writeFileSync(receipt, `${JSON.stringify({ format: "pipedrive-chatgpt-plugin-receipt-v1" })}\n`);
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_receipt_artifact_invalid/);
    writeFileSync(receipt, `${JSON.stringify({ format: "wrong", artifact: "pipedrive-sandbox-0.3.4" })}\n`);
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_receipt_format_invalid/);
    writeFileSync(receipt, `${JSON.stringify({ format: "pipedrive-chatgpt-plugin-receipt-v1", artifact: "wrong" })}\n`);
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_receipt_artifact_invalid/);
    writeFileSync(receipt, `${JSON.stringify({ format: "pipedrive-chatgpt-plugin-receipt-v1", artifact: "pipedrive-sandbox-0.3.4", tree_sha256: "a".repeat(64) })}\n`);
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_receipt_files_missing/);
    writeFileSync(receipt, `${JSON.stringify({ format: "pipedrive-chatgpt-plugin-receipt-v1", artifact: "pipedrive-sandbox-0.3.4", tree_sha256: "a".repeat(64), files: [] })}\n`);
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_receipt_files_mismatch/);

    writeReceipt(receipt, artifact);
    const record = requiredClientArtifactRecord("sandbox", root);
    assert.equal(record.artifact_path, "dist/chatgpt-plugin/pipedrive-sandbox-0.3.4");
    assert.match(record.receipt_tree_sha256, /^[a-f0-9]{64}$/);

    writeFileSync(join(artifact, "plugin.json"), "https://pipedrive-mcp.pezzoslabs.com/mcp\n");
    writeReceipt(receipt, artifact);
    assert.throws(() => requiredClientArtifactRecord("sandbox", root), /worker_release_client_environment_mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeReceipt(receiptPath: string, artifact: string): void {
  const source = readFileSync(join(artifact, "plugin.json"));
  const files = [{
    path: "plugin.json",
    mode: "0644",
    sha256: createHash("sha256").update(source).digest("hex"),
  }];
  const tree = files.map((file) => `${file.path}\0${file.mode}\0${file.sha256}\n`).join("");
  writeFileSync(receiptPath, `${JSON.stringify({ format: "pipedrive-chatgpt-plugin-receipt-v1", artifact: "pipedrive-sandbox-0.3.4", files, tree_sha256: createHash("sha256").update(tree).digest("hex") })}\n`);
}
