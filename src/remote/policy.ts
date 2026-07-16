import type { RemoteEnv } from "./env.js";

const POLICY_KEY = "policy";
const CSRF_KEY = "csrf";
const CSRF_TTL_MS = 10 * 60_000;

export type UserPolicyRecord = {
  writes: boolean;
  deletes: boolean;
  mailbox: boolean;
  revision: number;
  updatedAt: string;
};

export type PolicyUpdate = {
  writes: boolean;
  deletes: boolean;
  mailbox: boolean;
  expectedRevision: number;
};

export interface KeyValueOps {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface KeyValueStorage extends KeyValueOps {
  transaction<T>(closure: (transaction: KeyValueOps) => Promise<T>): Promise<T>;
}

type CsrfRecord = {
  digest: string;
  expiresAt: number;
};

export class UserPolicyStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: () => number = Date.now,
  ) {}

  async read(): Promise<UserPolicyRecord> {
    return (await this.storage.get<UserPolicyRecord>(POLICY_KEY)) ?? defaultUserPolicy();
  }

  async issueCsrf(): Promise<string> {
    const value = randomBase64Url(32);
    const digest = await hash(value);
    await this.storage.put<CsrfRecord>(CSRF_KEY, {
      digest,
      expiresAt: this.now() + CSRF_TTL_MS,
    });
    return value;
  }

  async update(input: PolicyUpdate, csrf: string): Promise<UserPolicyRecord> {
    validatePolicyUpdate(input);
    if (typeof csrf !== "string" || csrf.length < 32 || csrf.length > 256) {
      throw new Error("csrf_invalid");
    }
    const csrfDigest = await hash(csrf);
    return this.storage.transaction(async (transaction) => {
      const csrfRecord = await transaction.get<CsrfRecord>(CSRF_KEY);
      await transaction.delete(CSRF_KEY);
      if (
        !csrfRecord ||
        csrfRecord.expiresAt < this.now() ||
        csrfRecord.digest !== csrfDigest
      ) {
        throw new Error("csrf_invalid");
      }

      const current =
        (await transaction.get<UserPolicyRecord>(POLICY_KEY)) ?? defaultUserPolicy();
      if (current.revision !== input.expectedRevision) {
        throw new Error("policy_conflict");
      }
      const updated: UserPolicyRecord = {
        writes: input.writes,
        deletes: input.deletes,
        mailbox: input.mailbox,
        revision: current.revision + 1,
        updatedAt: new Date(this.now()).toISOString(),
      };
      await transaction.put(POLICY_KEY, updated);
      return updated;
    });
  }
}

export class UserPolicy {
  private readonly store: UserPolicyStore;

  constructor(state: DurableObjectState) {
    this.store = new UserPolicyStore(state.storage as unknown as KeyValueStorage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/policy") {
        return Response.json(await this.store.read());
      }
      if (request.method === "POST" && url.pathname === "/csrf") {
        return Response.json({ csrf: await this.store.issueCsrf() });
      }
      if (request.method === "PUT" && url.pathname === "/policy") {
        const input = await request.json() as PolicyUpdate;
        const csrf = request.headers.get("x-csrf-token") ?? "";
        return Response.json(await this.store.update(input, csrf));
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      const code = error instanceof Error ? error.message : "policy_error";
      const status = code === "policy_conflict" ? 409 : code === "csrf_invalid" ? 403 : 400;
      return Response.json({ code }, { status });
    }
  }
}

export async function getUserPolicy(env: RemoteEnv, sub: string): Promise<UserPolicyRecord> {
  const response = await userPolicyStub(env, sub).fetch("https://policy.internal/policy");
  if (!response.ok) {
    throw new Error("policy_unavailable");
  }
  return response.json<UserPolicyRecord>();
}

export function userPolicyStub(env: RemoteEnv, sub: string): DurableObjectStub {
  return env.USER_POLICY.get(env.USER_POLICY.idFromName(sub));
}

export function defaultUserPolicy(): UserPolicyRecord {
  return {
    writes: false,
    deletes: false,
    mailbox: false,
    revision: 0,
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

function validatePolicyUpdate(input: PolicyUpdate): void {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.writes !== "boolean" ||
    typeof input.deletes !== "boolean" ||
    typeof input.mailbox !== "boolean" ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  ) {
    throw new Error("policy_invalid");
  }
}

function randomBase64Url(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return bytesToBase64Url(bytes);
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
