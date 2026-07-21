import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";

const forbiddenPathParts = new Set(["src", "tests", "node_modules", "dist"]);
const forbiddenNames = new Set([".env", "package-lock.json"]);

const forbiddenContentPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["Access assertion", /cf-access-jwt-assertion\s*:\s*\S+/i],
  [
    "configured remote secret",
    /^\s*(?:PIPEDRIVE_OAUTH_CLIENT_SECRET|PIPEDRIVE_OAUTH_ENCRYPTION_KEY|AUDIT_HMAC_KEY)\s*=\s*\S+/m,
  ],
];

export function assertSafeTextTree(root, options = {}) {
  const allowedMcpConfig = options.allowedMcpConfig ?? null;
  const allowedFiles = options.allowedFiles ? new Set(options.allowedFiles) : null;
  for (const file of walk(root)) {
    const relativePath = relative(root, file);
    if (allowedFiles && !allowedFiles.has(relativePath)) {
      throw new Error(`Unexpected file in artifact: ${relativePath}`);
    }
    const parts = relativePath.split(/[\\/]/);
    if (parts.some((part) => forbiddenPathParts.has(part))) {
      throw new Error(`Forbidden path in artifact: ${relativePath}`);
    }
    const name = basename(file);
    if (forbiddenNames.has(name) || (name === ".mcp.json" && relativePath !== allowedMcpConfig)) {
      throw new Error(`Forbidden file in artifact: ${relativePath}`);
    }
    if (name.endsWith(".tgz")) {
      throw new Error(`Forbidden archive in artifact: ${relativePath}`);
    }
    if (/secret|token|credential/i.test(name) && !relativePath.startsWith(`docs/`)) {
      throw new Error(`Suspicious secret-like file in artifact: ${relativePath}`);
    }
    assertNoSensitiveContent(file, relativePath);
  }
}

export function assertNoSensitiveContent(file, relativePath) {
  const content = readFileSync(file, "utf8");
  for (const [label, pattern] of forbiddenContentPatterns) {
    if (pattern.test(content)) {
      throw new Error(`Suspicious ${label} content in artifact: ${relativePath}`);
    }
  }
}

export function* walk(root) {
  for (const entry of readdirSync(root).sort()) {
    const fullPath = join(root, entry);
    const stat = lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symbolic links are forbidden in artifacts: ${fullPath}`);
    }
    if (stat.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}
