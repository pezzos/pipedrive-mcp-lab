import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { targets } from "./validate-worker-topology.mjs";

export function validateClientTarget(target, root = process.cwd()) {
  if (target === "production") throw new Error("production_client_metadata_missing");
  if (target !== "sandbox") throw new Error("client_target_invalid");
  const sourcePath = join(root, "plugin", "chatgpt", "plugin-source.json");
  const source = readFileSync(sourcePath, "utf8");
  const metadata = JSON.parse(source);
  if (metadata.mcp_url !== `${targets.sandbox.origin}/mcp` || source.includes(targets.production.origin)) {
    throw new Error("sandbox_client_target_invalid");
  }
  return { path: sourcePath, hash: createHash("sha256").update(source).digest("hex") };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const index = process.argv.indexOf("--target");
  const target = index === -1 ? undefined : process.argv[index + 1];
  if (!target) throw new Error("Usage: node scripts/validate-client-environment.mjs --target sandbox|production");
  validateClientTarget(target);
  console.log("client_environment_valid");
}
