import { lengthPrefixedObjectKey, tenantRegistryObjectKey } from "./objectKey.js";
import type { KeyValueOps, KeyValueStorage } from "./policy.js";

const TENANT_INDEX_KEY = "tenant-index:v1";
const CONNECTION_INDEX_KEY = "connection-index:v1";
const ADMIN_ACTION_TTL_MS = 10 * 60_000;
const DEFAULT_ADMISSION_LATENCY_MS = 8;
const MAX_TENANTS = 200;
const MAX_CONNECTIONS = 500;

export type TenantStatus = "active" | "suspended";
export type TenantAdminAction = "approve" | "suspend" | "resume" | "force-disconnect";

export type TenantRecord = {
  domain: string;
  status: TenantStatus;
  tenantId: string;
  companyId?: string;
  companyName?: string;
  generation: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type TenantAdmission =
  | { active: false; code: "tenant_admission_denied" }
  | { active: true; tenant: TenantRecord };

export type AdminConnectionState = "connected" | "reconnect-required";

export type AdminConnectionProjectionInput = {
  connectionRef: string;
  accessSub: string;
  accessEmail: string;
  domain: string;
  state: AdminConnectionState;
  generation: number;
  connectedAtMs: number;
  lastUsedAtMs?: number;
  tokenExpiresAtMs?: number;
};

export type AdminConnectionProjection = Omit<AdminConnectionProjectionInput, "accessSub">;

type StoredAdminConnectionProjection = AdminConnectionProjection & {
  accessSub: string;
};

export type ForceDisconnectTarget = AdminConnectionProjection & {
  accessSub: string;
  tenantId: string;
};

/** Safe registry-derived display data used only by the admin confirmation. */
export type AdminActionTicket = {
  actionToken: string;
  forceDisconnectTarget?: AdminConnectionProjection;
};

export type TenantAdminProjection = {
  tenants: Array<TenantRecord & { connectedUserCount: number }>;
  connections: AdminConnectionProjection[];
};

type AdminActionRecord = {
  digest: string;
  adminSub: string;
  action: TenantAdminAction;
  target: string;
  expectedGeneration: number;
  expiresAtMs: number;
};

type RegistryOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TenantRegistryErrorCode };

export type TenantRegistryCoreOptions = {
  now?: () => number;
  monotonicNow?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  admissionLatencyMs?: number;
  randomOpaqueId?: () => string;
  randomActionToken?: () => string;
};

export class TenantRegistryCore {
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly admissionLatencyMs: number;
  private readonly randomOpaqueId: () => string;
  private readonly randomActionToken: () => string;

  constructor(
    private readonly storage: KeyValueStorage,
    options: TenantRegistryCoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? Date.now;
    this.sleep = options.sleep ?? delay;
    this.admissionLatencyMs = boundedAdmissionLatency(options.admissionLatencyMs);
    this.randomOpaqueId = options.randomOpaqueId ?? (() => randomBase64Url(18));
    this.randomActionToken = options.randomActionToken ?? (() => randomBase64Url(32));
  }

  /**
   * Ordinary admission always performs one storage lookup and one latency
   * normalization step, including malformed, unknown, and suspended domains.
   */
  async checkAdmission(input: unknown): Promise<TenantAdmission> {
    const startedAt = this.monotonicNow();
    const domain = tryNormalizePipedriveSubdomain(input);
    const lookupDomain = domain ?? "invalid-admission-sentinel";
    let record: TenantRecord | undefined;
    let storageFailed = false;

    try {
      record = await this.storage.get<TenantRecord>(tenantStorageKey(lookupDomain));
    } catch {
      storageFailed = true;
    }

    const elapsed = Math.max(0, this.monotonicNow() - startedAt);
    await this.sleep(Math.max(0, this.admissionLatencyMs - elapsed));

    if (storageFailed) {
      throw registryError("tenant_registry_unavailable");
    }
    if (domain !== undefined && isTenantRecord(record, domain) && record.status === "active") {
      return { active: true, tenant: cloneTenantRecord(record) };
    }
    return { active: false, code: "tenant_admission_denied" };
  }

  async issueAdminAction(
    adminSubInput: unknown,
    actionInput: unknown,
    targetInput: unknown,
  ): Promise<string> {
    return (await this.issueAdminActionTicket(adminSubInput, actionInput, targetInput)).actionToken;
  }

  async issueAdminActionTicket(
    adminSubInput: unknown,
    actionInput: unknown,
    targetInput: unknown,
  ): Promise<AdminActionTicket> {
    const adminSub = boundedString(adminSubInput, 256, "tenant_admin_action_invalid");
    const action = normalizeAdminAction(actionInput);
    const target = action === "force-disconnect"
      ? boundedString(targetInput, 256, "tenant_admin_action_invalid")
      : normalizePipedriveSubdomain(targetInput);
    const actionToken = this.randomActionToken();
    validateOpaque(actionToken, 32, 256, "tenant_registry_internal_error");
    const digest = await hash(actionToken);

    let forceDisconnectTarget: AdminConnectionProjection | undefined;
    await this.withStorage(async (transaction) => {
      const expectedGeneration = action === "force-disconnect"
        ? await connectionGeneration(transaction, target)
        : (await transaction.get<TenantRecord>(tenantStorageKey(target)))?.generation ?? 0;
      if (action === "force-disconnect") {
        const row = await transaction.get<StoredAdminConnectionProjection>(connectionStorageKey(target));
        if (!isConnectionProjection(row)) throw registryError("tenant_admin_action_invalid");
        forceDisconnectTarget = publicConnectionProjection(row);
      }
      await transaction.put<AdminActionRecord>(adminActionStorageKey(action), {
        digest,
        adminSub,
        action,
        target,
        expectedGeneration,
        expiresAtMs: this.now() + ADMIN_ACTION_TTL_MS,
      });
    });
    return { actionToken, ...(forceDisconnectTarget ? { forceDisconnectTarget } : {}) };
  }

  async approve(
    adminSub: unknown,
    domain: unknown,
    actionToken: unknown,
  ): Promise<TenantRecord> {
    return this.transition(adminSub, domain, actionToken, "approve");
  }

  async suspend(
    adminSub: unknown,
    domain: unknown,
    actionToken: unknown,
  ): Promise<TenantRecord> {
    return this.transition(adminSub, domain, actionToken, "suspend");
  }

  async resume(
    adminSub: unknown,
    domain: unknown,
    actionToken: unknown,
  ): Promise<TenantRecord> {
    return this.transition(adminSub, domain, actionToken, "resume");
  }

  async pinOrMatchCompany(
    domainInput: unknown,
    companyIdInput: unknown,
    companyNameInput: unknown,
  ): Promise<TenantRecord> {
    const domain = normalizePipedriveSubdomain(domainInput);
    const companyId = boundedIdentifier(companyIdInput, 128, "tenant_company_invalid");
    const companyName = normalizeCompanyName(companyNameInput);

    return this.withStorage(async (transaction) => {
      const current = await transaction.get<TenantRecord>(tenantStorageKey(domain));
      if (!isTenantRecord(current, domain) || current.status !== "active") {
        throw registryError("tenant_admission_denied");
      }
      if (current.companyId !== undefined && current.companyId !== companyId) {
        throw registryError("tenant_company_mismatch");
      }
      if (current.companyId === companyId && current.companyName === companyName) {
        return cloneTenantRecord(current);
      }
      const updated: TenantRecord = {
        ...current,
        companyId,
        companyName,
        generation: current.generation + 1,
        updatedAtMs: this.now(),
      };
      await transaction.put(tenantStorageKey(domain), updated);
      return cloneTenantRecord(updated);
    });
  }

  async upsertConnectionProjection(input: unknown): Promise<AdminConnectionProjection> {
    const row = normalizeConnectionProjection(input);
    return this.withStorage(async (transaction) => {
      const tenant = await transaction.get<TenantRecord>(tenantStorageKey(row.domain));
      if (!isTenantRecord(tenant, row.domain)) {
        throw registryError("tenant_admission_denied");
      }
      const index = await readStringIndex(transaction, CONNECTION_INDEX_KEY, MAX_CONNECTIONS);
      if (!index.includes(row.connectionRef)) {
        if (index.length >= MAX_CONNECTIONS) {
          throw registryError("tenant_registry_capacity_exceeded");
        }
        index.push(row.connectionRef);
        await transaction.put(CONNECTION_INDEX_KEY, index);
      }
      await transaction.put(connectionStorageKey(row.connectionRef), row);
      return publicConnectionProjection(row);
    });
  }

  async removeConnectionProjection(connectionRefInput: unknown): Promise<boolean> {
    const connectionRef = boundedString(
      connectionRefInput,
      256,
      "tenant_connection_projection_invalid",
    );
    return this.withStorage(async (transaction) => {
      const index = await readStringIndex(transaction, CONNECTION_INDEX_KEY, MAX_CONNECTIONS);
      const next = index.filter((value) => value !== connectionRef);
      const removed = await transaction.delete(connectionStorageKey(connectionRef));
      if (next.length !== index.length) {
        await transaction.put(CONNECTION_INDEX_KEY, next);
      }
      return removed;
    });
  }

  async getAdminProjection(): Promise<TenantAdminProjection> {
    return this.withStorage(async (transaction) => {
      const [tenantDomains, connectionRefs] = await Promise.all([
        readStringIndex(transaction, TENANT_INDEX_KEY, MAX_TENANTS),
        readStringIndex(transaction, CONNECTION_INDEX_KEY, MAX_CONNECTIONS),
      ]);
      const [tenantValues, connectionValues] = await Promise.all([
        Promise.all(tenantDomains.map((domain) => transaction.get<TenantRecord>(tenantStorageKey(domain)))),
        Promise.all(connectionRefs.map((ref) => transaction.get<StoredAdminConnectionProjection>(connectionStorageKey(ref)))),
      ]);
      const tenants = tenantValues.filter((value): value is TenantRecord => isTenantRecord(value));
      const connections = connectionValues
        .filter((value): value is StoredAdminConnectionProjection => isConnectionProjection(value))
        .map(publicConnectionProjection);
      return {
        tenants: tenants.map((tenant) => ({
          ...cloneTenantRecord(tenant),
          connectedUserCount: connections.filter(
            (connection) => connection.domain === tenant.domain && connection.state === "connected",
          ).length,
        })),
        connections,
      };
    });
  }

  async consumeForceDisconnectAction(
    adminSubInput: unknown,
    connectionRefInput: unknown,
    actionTokenInput: unknown,
  ): Promise<ForceDisconnectTarget> {
    const adminSub = boundedString(adminSubInput, 256, "tenant_admin_action_invalid");
    const connectionRef = boundedString(
      connectionRefInput,
      256,
      "tenant_admin_action_invalid",
    );
    const actionToken = boundedString(actionTokenInput, 256, "tenant_admin_action_invalid");
    if (utf8Length(actionToken) < 32) {
      throw registryError("tenant_admin_action_invalid");
    }
    const digest = await hash(actionToken);
    const outcome = await this.withStorage<RegistryOperationResult<ForceDisconnectTarget>>(async (transaction) => {
      const row = await transaction.get<StoredAdminConnectionProjection>(
        connectionStorageKey(connectionRef),
      );
      const generation = isConnectionProjection(row) ? row.generation : -1;
      const valid = await consumeActionRecord(
        transaction,
        digest,
        adminSub,
        "force-disconnect",
        connectionRef,
        generation,
        this.now(),
      );
      if (!valid || !isConnectionProjection(row)) {
        return { ok: false, error: "tenant_admin_action_invalid" };
      }
      const tenant = await transaction.get<TenantRecord>(tenantStorageKey(row.domain));
      if (!isTenantRecord(tenant, row.domain)) {
        return { ok: false, error: "tenant_admin_action_invalid" };
      }
      return { ok: true, value: { ...row, tenantId: tenant.tenantId } };
    });
    if (outcome.ok) {
      return outcome.value;
    }
    throw registryError(outcome.error);
  }

  private async transition(
    adminSubInput: unknown,
    domainInput: unknown,
    actionTokenInput: unknown,
    action: Exclude<TenantAdminAction, "force-disconnect">,
  ): Promise<TenantRecord> {
    const adminSub = boundedString(adminSubInput, 256, "tenant_admin_action_invalid");
    const domain = normalizePipedriveSubdomain(domainInput);
    const actionToken = boundedString(actionTokenInput, 256, "tenant_admin_action_invalid");
    if (utf8Length(actionToken) < 32) {
      throw registryError("tenant_admin_action_invalid");
    }
    const digest = await hash(actionToken);

    const outcome = await this.withStorage<RegistryOperationResult<TenantRecord>>(async (transaction) => {
      const current = await transaction.get<TenantRecord>(tenantStorageKey(domain));
      const currentGeneration = isTenantRecord(current, domain) ? current.generation : 0;
      const actionValid = await consumeActionRecord(
        transaction,
        digest,
        adminSub,
        action,
        domain,
        currentGeneration,
        this.now(),
      );
      if (!actionValid) {
        return { ok: false, error: "tenant_admin_action_invalid" };
      }

      const timestamp = this.now();
      if (action === "approve") {
        if (current !== undefined) {
          return { ok: false, error: "tenant_registry_conflict" };
        }
        const tenantId = this.randomOpaqueId();
        validateOpaque(tenantId, 16, 128, "tenant_registry_internal_error");
        const index = await readStringIndex(transaction, TENANT_INDEX_KEY, MAX_TENANTS);
        if (index.length >= MAX_TENANTS) {
          return { ok: false, error: "tenant_registry_capacity_exceeded" };
        }
        const approved: TenantRecord = {
          domain,
          status: "active",
          tenantId,
          generation: 1,
          createdAtMs: timestamp,
          updatedAtMs: timestamp,
        };
        index.push(domain);
        await transaction.put(tenantStorageKey(domain), approved);
        await transaction.put(TENANT_INDEX_KEY, index);
        return { ok: true, value: cloneTenantRecord(approved) };
      }

      if (!isTenantRecord(current, domain)) {
        return { ok: false, error: "tenant_registry_conflict" };
      }
      const expectedStatus: TenantStatus = action === "suspend" ? "active" : "suspended";
      const nextStatus: TenantStatus = action === "suspend" ? "suspended" : "active";
      if (current.status !== expectedStatus) {
        return { ok: false, error: "tenant_registry_conflict" };
      }
      const updated: TenantRecord = {
        ...current,
        status: nextStatus,
        generation: current.generation + 1,
        updatedAtMs: timestamp,
      };
      await transaction.put(tenantStorageKey(domain), updated);
      return { ok: true, value: cloneTenantRecord(updated) };
    });
    if (outcome.ok) {
      return outcome.value;
    }
    throw registryError(outcome.error);
  }

  private async withStorage<T>(closure: (transaction: KeyValueOps) => Promise<T>): Promise<T> {
    try {
      return await this.storage.transaction(closure);
    } catch (error) {
      if (isRegistryError(error)) {
        throw error;
      }
      throw registryError("tenant_registry_unavailable");
    }
  }
}

export class TenantRegistry {
  private readonly core: TenantRegistryCore;

  constructor(state: DurableObjectState) {
    this.core = new TenantRegistryCore(state.storage as unknown as KeyValueStorage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/admission") {
        const body = await requestJson(request);
        const admission = await this.core.checkAdmission(body.domain);
        return admission.active
          ? Response.json(admission)
          : Response.json({ code: admission.code }, { status: 403 });
      }
      if (request.method === "GET" && url.pathname === "/admin/projection") {
        return Response.json(await this.core.getAdminProjection());
      }
      if (request.method === "POST" && url.pathname === "/admin/action-ticket") {
        const body = await requestJson(request);
        return Response.json(await this.core.issueAdminActionTicket(
          body.adminSub, body.action, body.target,
        ));
      }
      if (request.method === "POST" && url.pathname === "/admin/approve") {
        const body = await requestJson(request);
        return Response.json(await this.core.approve(body.adminSub, body.domain, body.actionToken));
      }
      if (request.method === "POST" && url.pathname === "/admin/suspend") {
        const body = await requestJson(request);
        return Response.json(await this.core.suspend(body.adminSub, body.domain, body.actionToken));
      }
      if (request.method === "POST" && url.pathname === "/admin/resume") {
        const body = await requestJson(request);
        return Response.json(await this.core.resume(body.adminSub, body.domain, body.actionToken));
      }
      if (request.method === "POST" && url.pathname === "/company/pin") {
        const body = await requestJson(request);
        return Response.json(
          await this.core.pinOrMatchCompany(body.domain, body.companyId, body.companyName),
        );
      }
      if (request.method === "PUT" && url.pathname === "/admin/connection") {
        const body = await requestJson(request);
        return Response.json(await this.core.upsertConnectionProjection(body));
      }
      if (request.method === "DELETE" && url.pathname === "/admin/connection") {
        const body = await requestJson(request);
        return Response.json({
          removed: await this.core.removeConnectionProjection(body.connectionRef),
        });
      }
      if (request.method === "POST" && url.pathname === "/admin/force-disconnect/consume") {
        const body = await requestJson(request);
        return Response.json(
          await this.core.consumeForceDisconnectAction(
            body.adminSub,
            body.connectionRef,
            body.actionToken,
          ),
        );
      }
      return Response.json({ code: "tenant_registry_not_found" }, { status: 404 });
    } catch (error) {
      const code = normalizeRegistryError(error);
      return Response.json({ code }, { status: tenantRegistryErrorStatus(code) });
    }
  }
}

export type TenantRegistryEnv = {
  TENANT_REGISTRY: DurableObjectNamespace;
};

export function tenantRegistryStub(env: TenantRegistryEnv): DurableObjectStub {
  return env.TENANT_REGISTRY.get(
    env.TENANT_REGISTRY.idFromName(tenantRegistryObjectKey()),
  );
}

export function normalizePipedriveSubdomain(value: unknown): string {
  if (typeof value !== "string") {
    throw registryError("tenant_domain_invalid");
  }
  const domain = value.trim().toLowerCase();
  if (
    domain.length === 0 ||
    domain.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(domain)
  ) {
    throw registryError("tenant_domain_invalid");
  }
  return domain;
}

const registryErrorStatuses = {
  tenant_admission_denied: 403,
  tenant_admin_action_invalid: 403,
  tenant_company_invalid: 400,
  tenant_company_mismatch: 409,
  tenant_connection_projection_invalid: 400,
  tenant_domain_invalid: 400,
  tenant_registry_capacity_exceeded: 409,
  tenant_registry_conflict: 409,
  tenant_registry_internal_error: 503,
  tenant_registry_not_found: 404,
  tenant_registry_request_invalid: 400,
  tenant_registry_unavailable: 503,
} as const;

export type TenantRegistryErrorCode = keyof typeof registryErrorStatuses;

export function tenantRegistryErrorStatus(code: TenantRegistryErrorCode): number {
  return registryErrorStatuses[code];
}

function normalizeRegistryError(error: unknown): TenantRegistryErrorCode {
  const message = error instanceof Error ? error.message : "";
  return message in registryErrorStatuses
    ? message as TenantRegistryErrorCode
    : "tenant_registry_internal_error";
}

async function consumeActionRecord(
  transaction: KeyValueOps,
  digest: string,
  adminSub: string,
  action: TenantAdminAction,
  target: string,
  currentGeneration: number,
  now: number,
): Promise<boolean> {
  const key = adminActionStorageKey(action);
  const record = await transaction.get<AdminActionRecord>(key);
  await transaction.delete(key);
  if (
    !record ||
    record.digest !== digest ||
    record.adminSub !== adminSub ||
    record.action !== action ||
    record.target !== target ||
    record.expectedGeneration !== currentGeneration ||
    record.expiresAtMs <= now
  ) {
    return false;
  }
  return true;
}

async function connectionGeneration(
  transaction: KeyValueOps,
  connectionRef: string,
): Promise<number> {
  const row = await transaction.get<StoredAdminConnectionProjection>(
    connectionStorageKey(connectionRef),
  );
  if (!isConnectionProjection(row)) {
    throw registryError("tenant_admin_action_invalid");
  }
  return row.generation;
}

function normalizeConnectionProjection(input: unknown): StoredAdminConnectionProjection {
  if (typeof input !== "object" || input === null) {
    throw registryError("tenant_connection_projection_invalid");
  }
  const value = input as Record<string, unknown>;
  const state = value.state;
  if (state !== "connected" && state !== "reconnect-required") {
    throw registryError("tenant_connection_projection_invalid");
  }
  const connectedAtMs = timestamp(value.connectedAtMs);
  const lastUsedAtMs = optionalTimestamp(value.lastUsedAtMs);
  const tokenExpiresAtMs = optionalTimestamp(value.tokenExpiresAtMs);
  const generation = nonNegativeInteger(value.generation);
  return {
    connectionRef: boundedString(value.connectionRef, 256, "tenant_connection_projection_invalid"),
    accessSub: boundedString(value.accessSub, 256, "tenant_connection_projection_invalid"),
    accessEmail: normalizeAccessEmail(value.accessEmail),
    domain: normalizePipedriveSubdomain(value.domain),
    state,
    generation,
    connectedAtMs,
    ...(lastUsedAtMs === undefined ? {} : { lastUsedAtMs }),
    ...(tokenExpiresAtMs === undefined ? {} : { tokenExpiresAtMs }),
  };
}

function isConnectionProjection(value: unknown): value is StoredAdminConnectionProjection {
  try {
    normalizeConnectionProjection(value);
    return true;
  } catch {
    return false;
  }
}

function isTenantRecord(value: unknown, domain?: string): value is TenantRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<TenantRecord>;
  return (
    typeof record.domain === "string" &&
    (domain === undefined || record.domain === domain) &&
    (record.status === "active" || record.status === "suspended") &&
    typeof record.tenantId === "string" &&
    Number.isInteger(record.generation) &&
    (record.generation as number) > 0 &&
    Number.isFinite(record.createdAtMs) &&
    Number.isFinite(record.updatedAtMs) &&
    (record.companyId === undefined || typeof record.companyId === "string") &&
    (record.companyName === undefined || typeof record.companyName === "string")
  );
}

function cloneTenantRecord(record: TenantRecord): TenantRecord {
  return { ...record };
}

async function readStringIndex(
  transaction: KeyValueOps,
  key: string,
  limit: number,
): Promise<string[]> {
  const value = await transaction.get<unknown>(key);
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.length > limit ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw registryError("tenant_registry_internal_error");
  }
  return [...value];
}

function tenantStorageKey(domain: string): string {
  return lengthPrefixedObjectKey("tenant-record", domain);
}

function connectionStorageKey(connectionRef: string): string {
  return lengthPrefixedObjectKey("tenant-connection-projection", connectionRef);
}

function adminActionStorageKey(action: TenantAdminAction): string {
  return lengthPrefixedObjectKey("tenant-admin-action-current", action);
}

function publicConnectionProjection(
  row: StoredAdminConnectionProjection,
): AdminConnectionProjection {
  const { accessSub: _accessSub, ...projection } = row;
  return projection;
}

function tryNormalizePipedriveSubdomain(value: unknown): string | undefined {
  try {
    return normalizePipedriveSubdomain(value);
  } catch {
    return undefined;
  }
}

function normalizeCompanyName(value: unknown): string {
  const name = boundedString(value, 160, "tenant_company_invalid")
    .trim()
    .replace(/\s+/gu, " ");
  if (name.length === 0 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw registryError("tenant_company_invalid");
  }
  return name;
}

function normalizeAccessEmail(value: unknown): string {
  const email = boundedString(value, 320, "tenant_connection_projection_invalid").trim();
  if (!email.includes("@") || /[\u0000-\u001f\u007f]/u.test(email)) {
    throw registryError("tenant_connection_projection_invalid");
  }
  return email;
}

function normalizeAdminAction(value: unknown): TenantAdminAction {
  if (
    value !== "approve" &&
    value !== "suspend" &&
    value !== "resume" &&
    value !== "force-disconnect"
  ) {
    throw registryError("tenant_admin_action_invalid");
  }
  return value;
}

function boundedIdentifier(value: unknown, max: number, code: TenantRegistryErrorCode): string {
  const normalized = boundedString(value, max, code).trim();
  if (normalized.length === 0 || /[\u0000-\u0020\u007f]/u.test(normalized)) {
    throw registryError(code);
  }
  return normalized;
}

function boundedString(value: unknown, max: number, code: TenantRegistryErrorCode): string {
  if (typeof value !== "string" || utf8Length(value) === 0 || utf8Length(value) > max) {
    throw registryError(code);
  }
  return value;
}

function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw registryError("tenant_connection_projection_invalid");
  }
  return value;
}

function optionalTimestamp(value: unknown): number | undefined {
  return value === undefined ? undefined : timestamp(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw registryError("tenant_connection_projection_invalid");
  }
  return value;
}

function boundedAdmissionLatency(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_ADMISSION_LATENCY_MS;
  }
  if (!Number.isFinite(value) || value < 0 || value > 50) {
    throw registryError("tenant_registry_internal_error");
  }
  return value;
}

function validateOpaque(
  value: string,
  minimumBytes: number,
  maximumBytes: number,
  code: TenantRegistryErrorCode,
): void {
  const length = utf8Length(value);
  if (
    length < minimumBytes ||
    length > maximumBytes ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw registryError(code);
  }
}

function registryError(code: TenantRegistryErrorCode): Error {
  return new Error(code);
}

function isRegistryError(error: unknown): error is Error {
  return error instanceof Error && error.message in registryErrorStatuses;
}

async function requestJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw registryError("tenant_registry_request_invalid");
  }
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomBase64Url(length: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
