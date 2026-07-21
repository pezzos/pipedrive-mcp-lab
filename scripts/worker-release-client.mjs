import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { targets } from "./validate-worker-topology.mjs";

export function requiredClientArtifactRecord(target, root = process.cwd()) {
  const sourcePath = join(root, "plugin", "chatgpt", "plugin-source.json");
  const artifactName = target === "sandbox" ? "pipedrive-sandbox-0.3.4" : undefined;
  if (!artifactName) throw new Error("production_client_metadata_missing");
  const artifactPath = join(root, "dist", "chatgpt-plugin", artifactName);
  const receiptPath = join(root, "dist", "chatgpt-plugin", `${artifactName}.sha256.json`);
  if (!existsSync(artifactPath)) throw new Error("worker_release_client_artifact_missing");
  if (!existsSync(receiptPath)) throw new Error("worker_release_client_receipt_missing");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt.format !== "pipedrive-chatgpt-plugin-receipt-v1") {
    throw new Error("worker_release_client_receipt_format_invalid");
  }
  if (receipt.artifact !== artifactName) throw new Error("worker_release_client_receipt_artifact_invalid");
  if (typeof receipt.tree_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(receipt.tree_sha256)) {
    throw new Error("worker_release_client_receipt_tree_missing");
  }
  const files = artifactFiles(artifactPath);
  if (!Array.isArray(receipt.files)) throw new Error("worker_release_client_receipt_files_missing");
  const expectedFiles = files.map((file) => ({ path: file.path, mode: file.mode, sha256: file.sha256 }));
  if (JSON.stringify(receipt.files) !== JSON.stringify(expectedFiles)) {
    throw new Error("worker_release_client_receipt_files_mismatch");
  }
  const expectedTree = hashText(expectedFiles.map((file) => `${file.path}\0${file.mode}\0${file.sha256}\n`).join(""));
  if (receipt.tree_sha256 !== expectedTree) throw new Error("worker_release_client_receipt_tree_mismatch");
  assertNoOppositeOrigin(artifactPath, target);
  return {
    metadata_path: relative(root, sourcePath),
    metadata_sha256: hashFile(sourcePath),
    artifact_path: relative(root, artifactPath),
    artifact_tree_sha256: hashText(JSON.stringify(files.map((file) => [file.path, file.sha256]))),
    receipt_path: relative(root, receiptPath),
    receipt_sha256: hashFile(receiptPath),
    receipt_tree_sha256: receipt.tree_sha256,
  };
}

export function assertNoOppositeOrigin(directory, target) {
  const oppositeOrigin = target === "sandbox" ? targets.production.origin : targets.sandbox.origin;
  for (const file of artifactFiles(directory)) {
    if (readFileSync(join(directory, file.path), "utf8").includes(oppositeOrigin)) {
      throw new Error("worker_release_client_environment_mismatch");
    }
  }
}

function artifactFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push({
        path: relative(directory, path),
        mode: (lstatSync(path).mode & 0o777).toString(8).padStart(4, "0"),
        sha256: hashFile(path),
      });
      else if (lstatSync(path).isSymbolicLink()) throw new Error("worker_release_tree_symlink_forbidden");
      else throw new Error("worker_release_tree_entry_invalid");
    }
  };
  visit(directory);
  return files;
}

function hashFile(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function hashText(value) { return createHash("sha256").update(value).digest("hex"); }
