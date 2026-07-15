export type AuditOutcome = "success" | "denied" | "error";

export type AuditEvent = {
  v: 1;
  ts: string;
  requestId: string;
  actorId: string;
  route: string;
  operation: string;
  effect: "read" | "write" | "delete" | "policy" | "oauth";
  dryRun?: boolean;
  outcome: AuditOutcome;
  httpStatus: number;
  latencyMs: number;
  targetIds?: Record<string, string | number>;
  errorCode?: string;
  policyRevision?: number;
  policyChanges?: Partial<
    Record<"writes" | "deletes" | "mailbox", { from: boolean; to: boolean }>
  >;
};

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

export class ConsoleAuditSink implements AuditSink {
  async write(event: AuditEvent): Promise<void> {
    console.log(JSON.stringify(event));
  }
}

export async function pseudonymizeAccessSub(sub: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function extractTargetIds(value: unknown): Record<string, string | number> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const result: Record<string, string | number> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (
      /^[a-z][a-z0-9_]{0,63}_id$/.test(key) &&
      ((typeof candidate === "number" && Number.isSafeInteger(candidate)) ||
        (typeof candidate === "string" && candidate.length <= 128))
    ) {
      result[key] = candidate;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
