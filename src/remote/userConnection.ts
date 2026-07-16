import { normalizePipedriveApiDomain } from "./apiDomain.js";
import type { RemoteConfig, RemoteEnv } from "./env.js";
import { userConnectionObjectKey } from "./objectKey.js";
import {
  tenantRegistryStub,
  type AdminConnectionProjectionInput,
  type TenantAdmission,
  type TenantRecord,
} from "./tenantRegistry.js";
import {
  decryptMaterial,
  encryptMaterial,
  type EncryptedEnvelope,
  type OAuthMaterial,
} from "./tenantSecrets.js";
import type { KeyValueOps, KeyValueStorage } from "./policy.js";

const MATERIAL_KEY = "user-oauth-material:v1";
const CONNECTION_KEY = "user-connection:v1";
const STATE_KEY = "user-oauth-state:v1";
const ACTION_KEY = "user-action:v1";
const STATE_TTL_MS = 10 * 60_000;
const ACTION_TTL_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 60_000;
export const INACTIVE_TOKEN_RETENTION_MS = 90 * 24 * 60 * 60_000;
const TOKEN_ENDPOINT = "https://oauth.pipedrive.com/oauth/token";

type OAuthStateRecord = {
  digest: string;
  accessSub: string;
  accessEmail: string;
  expectedDomain: string;
  redirectUriHash: string;
  expectedGeneration: number;
  operationId: string;
  expiresAtMs: number;
};

type UserActionRecord = {
  digest: string;
  accessSub: string;
  expectedGeneration: number;
  expiresAtMs: number;
};

export type UserConnectionRecord = {
  generation: number;
  connectionRef?: string;
  accessSub?: string;
  accessEmail?: string;
  domain?: string;
  companyId?: string;
  companyName?: string;
  tenantId?: string;
  tenantGeneration?: number;
  operationId?: string;
  connectedAtMs?: number;
  lastUsedAtMs?: number;
  purgedAtMs?: number;
};

export type UserCredential = {
  accessCredential: string;
  apiDomain: string;
  expiresAtMs: number;
  domain: string;
  companyId: string;
  companyName: string;
  tenantId: string;
  generation: number;
};

export type UserConnectionStatus =
  | { connected: false; reconnectRequired: false; generation: number }
  | {
      connected: false;
      reconnectRequired: true;
      generation: number;
      domain: string;
      companyId: string;
      companyName: string;
      connectedAtMs?: number;
      lastUsedAtMs?: number;
      purgedAtMs?: number;
    }
  | {
      connected: true;
      reconnectRequired: false;
      generation: number;
      domain: string;
      companyId: string;
      companyName: string;
      expiresAtMs: number;
      connectedAtMs?: number;
      lastUsedAtMs?: number;
    };

type CurrentCompany = {
  companyId: string;
  companyName: string;
};

type MaterialSnapshot = {
  envelope?: EncryptedEnvelope;
  material?: OAuthMaterial;
  connection: UserConnectionRecord;
};

type OAuthResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  api_domain?: unknown;
  error?: unknown;
};

export interface TenantRegistryPort {
  checkAdmission(domain: string): Promise<TenantRecord>;
  pinOrMatchCompany(domain: string, companyId: string, companyName: string): Promise<TenantRecord>;
  upsertProjection(input: AdminConnectionProjectionInput): Promise<void>;
  removeProjection(connectionRef: string): Promise<void>;
}

export type UserConnectionCoreOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  randomId?: () => string;
  setAlarm?: (timestamp: number) => Promise<void>;
};

export class UserConnectionCore {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly setAlarm: (timestamp: number) => Promise<void>;
  private readonly refreshInFlight = new Map<number, Promise<OAuthMaterial>>();

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly config: RemoteConfig,
    private readonly registry: TenantRegistryPort,
    options: UserConnectionCoreOptions = {},
  ) {
    const fetcher = options.fetcher ?? fetch;
    this.fetcher = (input, init) => fetcher(input, init);
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? (() => randomBase64Url(24));
    this.setAlarm = options.setAlarm ?? (async () => {});
  }

  async createState(input: {
    accessSub: string;
    accessEmail: string;
    expectedDomain: string;
    redirectUri: string;
    actionToken: string;
  }): Promise<string> {
    validateIdentity(input.accessSub, input.accessEmail);
    validateDomain(input.expectedDomain);
    validateRedirectUri(input.redirectUri);
    await this.registry.checkAdmission(input.expectedDomain);
    const state = randomBase64Url(32);
    const operationId = this.randomId();
    validateOpaque(operationId);
    const digest = await hash(state);
    validateBounded(input.actionToken, 256, "user_action_invalid");
    const actionDigest = await hash(input.actionToken);
    const redirectUriHash = await hash(input.redirectUri);
    await this.withStorage(async (transaction) => {
      const connection = connectionRecord(
        await transaction.get<UserConnectionRecord>(CONNECTION_KEY),
      );
      const action = await transaction.get<UserActionRecord>(ACTION_KEY);
      await transaction.delete(ACTION_KEY);
      if (
        !action ||
        action.digest !== actionDigest ||
        action.accessSub !== input.accessSub ||
        action.expectedGeneration !== connection.generation ||
        action.expiresAtMs <= this.now()
      ) {
        throw new Error("user_action_invalid");
      }
      await transaction.put<OAuthStateRecord>(STATE_KEY, {
        digest,
        accessSub: input.accessSub,
        accessEmail: input.accessEmail,
        expectedDomain: input.expectedDomain,
        redirectUriHash,
        expectedGeneration: connection.generation,
        operationId,
        expiresAtMs: this.now() + STATE_TTL_MS,
      });
    });
    return state;
  }

  async discardState(
    accessSub: string,
    state: string,
    redirectUri: string,
  ): Promise<void> {
    await this.consumeState(accessSub, state, redirectUri);
  }

  async exchange(input: {
    accessSub: string;
    state: string;
    code: string;
    redirectUri: string;
  }): Promise<UserConnectionStatus> {
    validateBounded(input.code, 4_096, "oauth_code_invalid");
    const oauthState = await this.consumeState(input.accessSub, input.state, input.redirectUri);
    await this.registry.checkAdmission(oauthState.expectedDomain);
    const response = await this.requestOAuth({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    });
    const material = parseOAuthMaterial(response, this.now());
    if (pipedriveSubdomainFromApiDomain(material.apiDomain) !== oauthState.expectedDomain) {
      throw new Error("tenant_domain_mismatch");
    }
    const company = await this.currentCompany(material);
    const tenant = await this.registry.pinOrMatchCompany(
      oauthState.expectedDomain,
      company.companyId,
      company.companyName,
    );
    const admission = await this.registry.checkAdmission(oauthState.expectedDomain);
    if (
      admission.companyId !== company.companyId ||
      admission.generation !== tenant.generation
    ) {
      throw new Error("tenant_admission_denied");
    }
    const encrypted = await encryptMaterial(material, this.config.encryptionKey);
    const prior = await this.readStoredSnapshot();
    const connectionRef = prior.connection.connectionRef ?? this.randomId();
    validateOpaque(connectionRef);
    let promoted: UserConnectionRecord | undefined;
    await this.withStorage(async (transaction) => {
      const current = connectionRecord(
        await transaction.get<UserConnectionRecord>(CONNECTION_KEY),
      );
      if (current.generation !== oauthState.expectedGeneration) {
        throw new Error("oauth_state_stale");
      }
      promoted = {
        generation: current.generation + 1,
        connectionRef,
        accessSub: oauthState.accessSub,
        accessEmail: oauthState.accessEmail,
        domain: oauthState.expectedDomain,
        companyId: company.companyId,
        companyName: company.companyName,
        tenantId: tenant.tenantId,
        tenantGeneration: tenant.generation,
        operationId: oauthState.operationId,
        connectedAtMs: this.now(),
      };
      await transaction.put(MATERIAL_KEY, encrypted);
      await transaction.put(CONNECTION_KEY, promoted);
    });
    const active = await this.registry.checkAdmission(oauthState.expectedDomain)
      .catch(async (error) => {
        await this.compensatePromotion(prior, promoted as UserConnectionRecord, encrypted);
        throw error;
      });
    if (
      active.companyId !== company.companyId ||
      active.generation !== tenant.generation
    ) {
      await this.compensatePromotion(prior, promoted as UserConnectionRecord, encrypted);
      throw new Error("tenant_admission_denied");
    }
    await this.scheduleRetention(promoted as UserConnectionRecord);
    await this.projectBestEffort(promoted as UserConnectionRecord, material.expiresAtMs);
    return this.getStatus();
  }

  async getCredential(accessSub: string): Promise<UserCredential> {
    const snapshot = await this.readSnapshot();
    assertConnectionOwner(snapshot.connection, accessSub);
    if (!snapshot.material || !isConnectedRecord(snapshot.connection)) {
      throw new Error(snapshot.connection.purgedAtMs === undefined
        ? "pipedrive_not_connected"
        : "pipedrive_reconnect_required");
    }
    await this.assertActive(snapshot.connection);
    const material = snapshot.material.expiresAtMs > this.now() + REFRESH_SKEW_MS
      ? snapshot.material
      : await this.refresh(snapshot);
    await this.assertActive(snapshot.connection);
    return credential(material, snapshot.connection);
  }

  async getStatus(): Promise<UserConnectionStatus> {
    const stored = await this.readStoredSnapshot();
    const connection = stored.connection;
    if (!stored.envelope || !isConnectedRecord(connection)) {
      if (isConnectionMetadata(connection) && connection.purgedAtMs !== undefined) {
        return {
          connected: false,
          reconnectRequired: true,
          generation: connection.generation,
          domain: connection.domain,
          companyId: connection.companyId,
          companyName: connection.companyName,
          ...(connection.connectedAtMs === undefined ? {} : { connectedAtMs: connection.connectedAtMs }),
          ...(connection.lastUsedAtMs === undefined ? {} : { lastUsedAtMs: connection.lastUsedAtMs }),
          purgedAtMs: connection.purgedAtMs,
        };
      }
      return { connected: false, reconnectRequired: false, generation: connection.generation };
    }
    try {
      const material = await decryptMaterial(stored.envelope, this.config.encryptionKey);
      return {
        connected: true,
        reconnectRequired: false,
        generation: connection.generation,
        domain: connection.domain,
        companyId: connection.companyId,
        companyName: connection.companyName,
        expiresAtMs: material.expiresAtMs,
        ...(connection.connectedAtMs === undefined ? {} : { connectedAtMs: connection.connectedAtMs }),
        ...(connection.lastUsedAtMs === undefined ? {} : { lastUsedAtMs: connection.lastUsedAtMs }),
      };
    } catch {
      return {
        connected: false,
        reconnectRequired: true,
        generation: connection.generation,
        domain: connection.domain,
        companyId: connection.companyId,
        companyName: connection.companyName,
        ...(connection.connectedAtMs === undefined ? {} : { connectedAtMs: connection.connectedAtMs }),
        ...(connection.lastUsedAtMs === undefined ? {} : { lastUsedAtMs: connection.lastUsedAtMs }),
      };
    }
  }

  async issueSelfAction(accessSub: string): Promise<string> {
    validateBounded(accessSub, 256, "user_action_invalid");
    const actionToken = randomBase64Url(32);
    const digest = await hash(actionToken);
    await this.withStorage(async (transaction) => {
      const connection = connectionRecord(
        await transaction.get<UserConnectionRecord>(CONNECTION_KEY),
      );
      await transaction.put<UserActionRecord>(ACTION_KEY, {
        digest,
        accessSub,
        expectedGeneration: connection.generation,
        expiresAtMs: this.now() + ACTION_TTL_MS,
      });
    });
    return actionToken;
  }

  async selfDisconnect(accessSub: string, actionToken: string): Promise<boolean> {
    validateBounded(actionToken, 256, "user_action_invalid");
    const digest = await hash(actionToken);
    const result = await this.withStorage(async (transaction) => {
      const [action, storedConnection, envelope] = await Promise.all([
        transaction.get<UserActionRecord>(ACTION_KEY),
        transaction.get<UserConnectionRecord>(CONNECTION_KEY),
        transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
      ]);
      await transaction.delete(ACTION_KEY);
      const current = connectionRecord(storedConnection);
      if (
        !action ||
        action.digest !== digest ||
        action.accessSub !== accessSub ||
        action.expectedGeneration !== current.generation ||
        action.expiresAtMs <= this.now()
      ) {
        throw new Error("user_action_invalid");
      }
      await this.disconnectTransaction(transaction, current);
      return { disconnected: Boolean(envelope), connectionRef: current.connectionRef };
    });
    await this.removeProjectionBestEffort(result.connectionRef);
    return result.disconnected;
  }

  async adminDisconnect(accessSub: string, expectedGeneration: number): Promise<boolean> {
    validateBounded(accessSub, 256, "admin_target_invalid");
    if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) {
      throw new Error("admin_target_invalid");
    }
    const result = await this.withStorage(async (transaction) => {
      const [storedConnection, envelope] = await Promise.all([
        transaction.get<UserConnectionRecord>(CONNECTION_KEY),
        transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
      ]);
      const current = connectionRecord(storedConnection);
      assertConnectionOwner(current, accessSub);
      if (current.generation !== expectedGeneration) {
        throw new Error("oauth_state_stale");
      }
      await this.disconnectTransaction(transaction, current);
      return { disconnected: Boolean(envelope), connectionRef: current.connectionRef };
    });
    await this.removeProjectionBestEffort(result.connectionRef);
    return result.disconnected;
  }

  async markUsed(accessSub: string, expectedGeneration: number): Promise<void> {
    const before = await this.readSnapshot();
    assertConnectionOwner(before.connection, accessSub);
    if (
      !before.material ||
      before.connection.generation !== expectedGeneration ||
      !isConnectedRecord(before.connection)
    ) {
      throw new Error("oauth_state_stale");
    }
    const admissionBefore = await this.assertActive(before.connection);
    const updated = await this.withStorage(async (transaction) => {
      const [storedConnection, envelope] = await Promise.all([
        transaction.get<UserConnectionRecord>(CONNECTION_KEY),
        transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
      ]);
      const current = connectionRecord(storedConnection);
      assertConnectionOwner(current, accessSub);
      if (!envelope || current.generation !== expectedGeneration || !isConnectedRecord(current)) {
        throw new Error("oauth_state_stale");
      }
      const next = { ...current, lastUsedAtMs: this.now() };
      await transaction.put(CONNECTION_KEY, next);
      return next;
    });
    try {
      const admissionAfter = await this.assertActive(updated);
      if (admissionAfter.generation !== admissionBefore.generation) {
        throw new Error("tenant_admission_denied");
      }
    } catch (error) {
      await this.withStorage(async (transaction) => {
        const current = connectionRecord(
          await transaction.get<UserConnectionRecord>(CONNECTION_KEY),
        );
        if (
          current.generation === updated.generation &&
          current.lastUsedAtMs === updated.lastUsedAtMs
        ) {
          await transaction.put(CONNECTION_KEY, before.connection);
        }
      });
      throw error;
    }
    await this.scheduleRetention(updated);
    await this.projectBestEffort(updated, before.material.expiresAtMs);
  }

  async purgeInactive(): Promise<boolean> {
    const snapshot = await this.readStoredSnapshot();
    const connection = snapshot.connection;
    if (!snapshot.envelope || !isConnectedRecord(connection)) {
      return false;
    }
    const base = connection.lastUsedAtMs ?? connection.connectedAtMs ?? this.now();
    const threshold = base + INACTIVE_TOKEN_RETENTION_MS;
    if (threshold > this.now()) {
      await this.setAlarm(threshold);
      return false;
    }
    const purged = await this.withStorage(async (transaction) => {
      const current = connectionRecord(
        await transaction.get<UserConnectionRecord>(CONNECTION_KEY),
      );
      const envelope = await transaction.get<EncryptedEnvelope>(MATERIAL_KEY);
      if (!envelope || current.generation !== connection.generation) {
        return false;
      }
      await transaction.delete(MATERIAL_KEY);
      await transaction.delete(STATE_KEY);
      await transaction.put<UserConnectionRecord>(CONNECTION_KEY, {
        ...current,
        generation: current.generation + 1,
        purgedAtMs: this.now(),
        operationId: undefined,
      });
      return true;
    });
    if (purged) {
      await this.projectReconnectRequiredBestEffort();
    }
    return purged;
  }

  private async consumeState(
    accessSub: string,
    state: string,
    redirectUri: string,
  ): Promise<OAuthStateRecord> {
    validateBounded(accessSub, 256, "oauth_state_invalid");
    validateBounded(state, 256, "oauth_state_invalid");
    validateRedirectUri(redirectUri);
    const digest = await hash(state);
    const redirectUriHash = await hash(redirectUri);
    const record = await this.withStorage(async (transaction) => {
      const current = await transaction.get<OAuthStateRecord>(STATE_KEY);
      await transaction.delete(STATE_KEY);
      return current;
    });
    if (
      !record ||
      record.digest !== digest ||
      record.accessSub !== accessSub ||
      record.redirectUriHash !== redirectUriHash ||
      record.expiresAtMs <= this.now()
    ) {
      throw new Error("oauth_state_invalid");
    }
    return record;
  }

  private async refresh(snapshot: MaterialSnapshot): Promise<OAuthMaterial> {
    const generation = snapshot.connection.generation;
    const existing = this.refreshInFlight.get(generation);
    if (existing) {
      return existing;
    }
    const promise = this.refreshOnce(snapshot).finally(() => {
      if (this.refreshInFlight.get(generation) === promise) {
        this.refreshInFlight.delete(generation);
      }
    });
    this.refreshInFlight.set(generation, promise);
    return promise;
  }

  private async refreshOnce(previous: MaterialSnapshot): Promise<OAuthMaterial> {
    if (!previous.material || !previous.envelope || !isConnectedRecord(previous.connection)) {
      throw new Error("pipedrive_not_connected");
    }
    const admissionBefore = await this.assertActive(previous.connection);
    const parsed = await this.requestOAuth({
      grant_type: "refresh_token",
      refresh_token: previous.material.refreshCredential,
    });
    const updated = parseOAuthMaterial(
      parsed,
      this.now(),
      previous.material.refreshCredential,
    );
    if (pipedriveSubdomainFromApiDomain(updated.apiDomain) !== previous.connection.domain) {
      throw new Error("tenant_domain_mismatch");
    }
    const admissionAfterProvider = await this.assertActive(previous.connection);
    if (admissionAfterProvider.generation !== admissionBefore.generation) {
      throw new Error("tenant_admission_denied");
    }
    const encrypted = await encryptMaterial(updated, this.config.encryptionKey);
    const persisted = await this.withStorage(async (transaction) => {
      const [storedConnection, envelope] = await Promise.all([
        transaction.get<UserConnectionRecord>(CONNECTION_KEY),
        transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
      ]);
      const current = connectionRecord(storedConnection);
      if (
        current.generation !== previous.connection.generation ||
        !sameEnvelope(envelope, previous.envelope)
      ) {
        return false;
      }
      await transaction.put(MATERIAL_KEY, encrypted);
      return true;
    });
    if (!persisted) {
      throw new Error("oauth_state_stale");
    }
    try {
      const admissionAfterPersist = await this.assertActive(previous.connection);
      if (admissionAfterPersist.generation !== admissionBefore.generation) {
        throw new Error("tenant_admission_denied");
      }
    } catch (error) {
      await this.withStorage(async (transaction) => {
        const current = connectionRecord(
          await transaction.get<UserConnectionRecord>(CONNECTION_KEY),
        );
        const envelope = await transaction.get<EncryptedEnvelope>(MATERIAL_KEY);
        if (
          current.generation === previous.connection.generation &&
          sameEnvelope(envelope, encrypted)
        ) {
          await transaction.put(MATERIAL_KEY, previous.envelope as EncryptedEnvelope);
        }
      });
      throw error;
    }
    await this.projectBestEffort(previous.connection, updated.expiresAtMs);
    return updated;
  }

  private async compensatePromotion(
    prior: Omit<MaterialSnapshot, "material">,
    promoted: UserConnectionRecord,
    promotedEnvelope: EncryptedEnvelope,
  ): Promise<void> {
    await this.withStorage(async (transaction) => {
      const [currentStored, envelope] = await Promise.all([
        transaction.get<UserConnectionRecord>(CONNECTION_KEY),
        transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
      ]);
      const current = connectionRecord(currentStored);
      if (
        current.generation !== promoted.generation ||
        current.operationId !== promoted.operationId ||
        !sameEnvelope(envelope, promotedEnvelope)
      ) {
        return;
      }
      if (prior.envelope && isConnectionMetadata(prior.connection)) {
        await transaction.put(MATERIAL_KEY, prior.envelope);
        await transaction.put<UserConnectionRecord>(CONNECTION_KEY, {
          ...prior.connection,
          generation: current.generation + 1,
        });
      } else {
        await transaction.delete(MATERIAL_KEY);
        await transaction.put<UserConnectionRecord>(CONNECTION_KEY, {
          generation: current.generation + 1,
        });
      }
    });
  }

  private async disconnectTransaction(
    transaction: KeyValueOps,
    current: UserConnectionRecord,
  ): Promise<void> {
    await transaction.delete(MATERIAL_KEY);
    await transaction.delete(STATE_KEY);
    await transaction.put<UserConnectionRecord>(CONNECTION_KEY, {
      generation: current.generation + 1,
    });
  }

  private async currentCompany(material: OAuthMaterial): Promise<CurrentCompany> {
    let response: Response;
    try {
      response = await this.fetcher(
        new URL("/api/v1/users/me", material.apiDomain),
        { headers: { authorization: `Bearer ${material.accessCredential}` } },
      );
    } catch {
      throw new Error("pipedrive_identity_unavailable");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("pipedrive_identity_invalid");
    }
    if (!response.ok || !isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
      throw new Error("pipedrive_identity_invalid");
    }
    return {
      companyId: boundedIdentifier(payload.data.company_id, 128, "pipedrive_identity_invalid"),
      companyName: boundedLabel(payload.data.company_name, 160, "pipedrive_identity_invalid"),
    };
  }

  private async requestOAuth(fields: Record<string, string>): Promise<OAuthResponse> {
    const authorization = btoa(
      `${this.config.pipedriveClientId}:${this.config.pipedriveClientSecret}`,
    );
    let response: Response;
    try {
      response = await this.fetcher(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Basic ${authorization}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields),
      });
    } catch {
      throw new Error("pipedrive_oauth_unavailable");
    }
    let parsed: OAuthResponse;
    try {
      parsed = await response.json() as OAuthResponse;
    } catch {
      throw new Error(response.ok ? "pipedrive_oauth_invalid_response" : "pipedrive_oauth_failed");
    }
    if (!response.ok) {
      throw new Error(parsed.error === "invalid_grant"
        ? "pipedrive_reconnect_required"
        : "pipedrive_oauth_failed");
    }
    return parsed;
  }

  private async assertActive(connection: UserConnectionRecord): Promise<TenantRecord> {
    if (!isConnectedRecord(connection)) {
      throw new Error("pipedrive_not_connected");
    }
    const tenant = await this.registry.checkAdmission(connection.domain);
    if (
      tenant.tenantId !== connection.tenantId ||
      tenant.companyId !== connection.companyId
    ) {
      throw new Error("tenant_admission_denied");
    }
    return tenant;
  }

  private async readStoredSnapshot(): Promise<Omit<MaterialSnapshot, "material">> {
    return this.withStorage(async (transaction) => {
      const [envelope, storedConnection] = await Promise.all([
        transaction.get<EncryptedEnvelope>(MATERIAL_KEY),
        transaction.get<UserConnectionRecord>(CONNECTION_KEY),
      ]);
      return { envelope, connection: connectionRecord(storedConnection) };
    });
  }

  private async readSnapshot(): Promise<MaterialSnapshot> {
    const stored = await this.readStoredSnapshot();
    return {
      ...stored,
      material: stored.envelope
        ? await decryptMaterial(stored.envelope, this.config.encryptionKey)
        : undefined,
    };
  }

  private async scheduleRetention(connection: UserConnectionRecord): Promise<void> {
    const base = connection.lastUsedAtMs ?? connection.connectedAtMs;
    if (base !== undefined) {
      await this.setAlarm(base + INACTIVE_TOKEN_RETENTION_MS);
    }
  }

  private async project(connection: UserConnectionRecord, expiresAtMs: number): Promise<void> {
    if (!isConnectedRecord(connection) || !connection.connectionRef || !connection.accessEmail) {
      return;
    }
    await this.registry.upsertProjection(projectionInput(connection, expiresAtMs));
  }

  private async projectBestEffort(
    connection: UserConnectionRecord,
    expiresAtMs: number,
  ): Promise<void> {
    await this.project(connection, expiresAtMs).catch((error) => {
      reportProjectionFailure("upsert", connection.tenantId, error);
    });
  }

  private async removeProjectionBestEffort(connectionRef: string | undefined): Promise<void> {
    if (connectionRef) {
      await this.registry.removeProjection(connectionRef).catch((error) => {
        reportProjectionFailure("remove", undefined, error);
      });
    }
  }

  private async projectReconnectRequiredBestEffort(): Promise<void> {
    const current = await this.readStoredSnapshot().then((value) => value.connection);
    if (
      !isConnectionMetadata(current) ||
      !current.connectionRef ||
      !current.accessSub ||
      !current.accessEmail ||
      current.connectedAtMs === undefined
    ) {
      return;
    }
    await this.registry.upsertProjection({
      connectionRef: current.connectionRef,
      accessSub: current.accessSub,
      accessEmail: current.accessEmail,
      domain: current.domain,
      state: "reconnect-required",
      generation: current.generation,
      connectedAtMs: current.connectedAtMs,
      ...(current.lastUsedAtMs === undefined ? {} : { lastUsedAtMs: current.lastUsedAtMs }),
    }).catch((error) => {
      reportProjectionFailure("reconnect-required", current.tenantId, error);
    });
  }

  private async withStorage<T>(closure: (transaction: KeyValueOps) => Promise<T>): Promise<T> {
    try {
      return await this.storage.transaction(closure);
    } catch (error) {
      if (error instanceof Error && /^[a-z0-9_:.-]{1,100}$/.test(error.message)) {
        throw error;
      }
      throw new Error("user_connection_storage_unavailable");
    }
  }
}

export class UserConnection {
  private readonly core: UserConnectionCore;

  constructor(state: DurableObjectState, env: RemoteEnv) {
    const registry = registryPort(env);
    this.core = new UserConnectionCore(
      state.storage as unknown as KeyValueStorage,
      connectionConfig(env),
      registry,
      { setAlarm: (timestamp) => state.storage.setAlarm(timestamp) },
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/state") {
        const body = await requestJson(request);
        return Response.json({ state: await this.core.createState({
          accessSub: String(body.accessSub ?? ""),
          accessEmail: String(body.accessEmail ?? ""),
          expectedDomain: String(body.expectedDomain ?? ""),
          redirectUri: String(body.redirectUri ?? ""),
          actionToken: String(body.actionToken ?? ""),
        }) });
      }
      if (request.method === "POST" && url.pathname === "/exchange") {
        const body = await requestJson(request);
        return Response.json(await this.core.exchange({
          accessSub: String(body.accessSub ?? ""),
          state: String(body.state ?? ""),
          code: String(body.code ?? ""),
          redirectUri: String(body.redirectUri ?? ""),
        }));
      }
      if (request.method === "POST" && url.pathname === "/state/discard") {
        const body = await requestJson(request);
        await this.core.discardState(
          String(body.accessSub ?? ""),
          String(body.state ?? ""),
          String(body.redirectUri ?? ""),
        );
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && url.pathname === "/credential") {
        const body = await requestJson(request);
        return Response.json(await this.core.getCredential(String(body.accessSub ?? "")));
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return Response.json(await this.core.getStatus());
      }
      if (request.method === "POST" && url.pathname === "/self-action") {
        const body = await requestJson(request);
        return Response.json({
          actionToken: await this.core.issueSelfAction(String(body.accessSub ?? "")),
        });
      }
      if (request.method === "POST" && url.pathname === "/disconnect") {
        const body = await requestJson(request);
        return Response.json({
          disconnected: await this.core.selfDisconnect(
            String(body.accessSub ?? ""),
            String(body.actionToken ?? ""),
          ),
        });
      }
      if (request.method === "POST" && url.pathname === "/admin-disconnect") {
        const body = await requestJson(request);
        return Response.json({
          disconnected: await this.core.adminDisconnect(
            String(body.accessSub ?? ""),
            Number(body.expectedGeneration),
          ),
        });
      }
      if (request.method === "POST" && url.pathname === "/used") {
        const body = await requestJson(request);
        await this.core.markUsed(String(body.accessSub ?? ""), Number(body.expectedGeneration));
        return new Response(null, { status: 204 });
      }
      return Response.json({ code: "user_connection_not_found" }, { status: 404 });
    } catch (error) {
      const code = safeCode(error, "user_connection_internal_error");
      return Response.json({ code }, { status: connectionErrorStatus(code) });
    }
  }

  async alarm(): Promise<void> {
    await this.core.purgeInactive();
  }
}

export function userConnectionStub(env: RemoteEnv, accessSub: string): DurableObjectStub {
  return env.USER_CONNECTION.get(
    env.USER_CONNECTION.idFromName(userConnectionObjectKey(accessSub)),
  );
}

function registryPort(env: RemoteEnv): TenantRegistryPort {
  const stub = tenantRegistryStub(env);
  return {
    async checkAdmission(domain) {
      const response = await stub.fetch("https://registry.internal/admission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      if (!response.ok) {
        throw new Error(await responseCode(response, "tenant_registry_unavailable"));
      }
      const admission = await response.json<TenantAdmission>();
      if (!admission.active) {
        throw new Error("tenant_admission_denied");
      }
      return admission.tenant;
    },
    async pinOrMatchCompany(domain, companyId, companyName) {
      const response = await stub.fetch("https://registry.internal/company/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, companyId, companyName }),
      });
      if (!response.ok) {
        throw new Error(await responseCode(response, "tenant_registry_unavailable"));
      }
      return response.json<TenantRecord>();
    },
    async upsertProjection(input) {
      const response = await stub.fetch("https://registry.internal/admin/connection", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await responseCode(response, "tenant_registry_unavailable"));
      }
    },
    async removeProjection(connectionRef) {
      const response = await stub.fetch("https://registry.internal/admin/connection", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionRef }),
      });
      if (!response.ok) {
        throw new Error(await responseCode(response, "tenant_registry_unavailable"));
      }
    },
  };
}

function projectionInput(
  connection: UserConnectionRecord & Required<Pick<UserConnectionRecord,
    "connectionRef" | "accessSub" | "accessEmail" | "domain" | "companyId" |
    "companyName" | "tenantId" | "connectedAtMs">>,
  expiresAtMs: number,
): AdminConnectionProjectionInput {
  return {
    connectionRef: connection.connectionRef,
    accessSub: connection.accessSub,
    accessEmail: connection.accessEmail,
    domain: connection.domain,
    state: "connected",
    generation: connection.generation,
    connectedAtMs: connection.connectedAtMs,
    ...(connection.lastUsedAtMs === undefined ? {} : { lastUsedAtMs: connection.lastUsedAtMs }),
    tokenExpiresAtMs: expiresAtMs,
  };
}

function credential(
  material: OAuthMaterial,
  connection: UserConnectionRecord,
): UserCredential {
  if (!isConnectedRecord(connection)) {
    throw new Error("pipedrive_not_connected");
  }
  return {
    accessCredential: material.accessCredential,
    apiDomain: material.apiDomain,
    expiresAtMs: material.expiresAtMs,
    domain: connection.domain,
    companyId: connection.companyId,
    companyName: connection.companyName,
    tenantId: connection.tenantId,
    generation: connection.generation,
  };
}

function connectionRecord(value: UserConnectionRecord | undefined): UserConnectionRecord {
  if (value === undefined) {
    return { generation: 0 };
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 0) {
    throw new Error("oauth_material_invalid");
  }
  return { ...value };
}

function isConnectionMetadata(
  value: UserConnectionRecord,
): value is UserConnectionRecord & Required<Pick<UserConnectionRecord,
  "domain" | "companyId" | "companyName" | "tenantId">> {
  return Boolean(value.domain && value.companyId && value.companyName && value.tenantId);
}

function isConnectedRecord(
  value: UserConnectionRecord,
): value is UserConnectionRecord & Required<Pick<UserConnectionRecord,
  "connectionRef" | "accessSub" | "accessEmail" | "domain" | "companyId" |
  "companyName" | "tenantId" | "tenantGeneration" | "connectedAtMs">> {
  return isConnectionMetadata(value) && Boolean(
    value.connectionRef &&
    value.accessSub &&
    value.accessEmail &&
    value.tenantGeneration !== undefined &&
    value.connectedAtMs !== undefined,
  );
}

function assertConnectionOwner(connection: UserConnectionRecord, accessSub: string): void {
  validateBounded(accessSub, 256, "access_token_invalid");
  if (connection.accessSub !== accessSub) {
    throw new Error("pipedrive_not_connected");
  }
}

function parseOAuthMaterial(
  parsed: OAuthResponse,
  now: number,
  previousRefresh?: string,
): OAuthMaterial {
  if (
    typeof parsed.access_token !== "string" ||
    parsed.access_token.length === 0 ||
    (!previousRefresh && (typeof parsed.refresh_token !== "string" || parsed.refresh_token.length === 0)) ||
    typeof parsed.expires_in !== "number" ||
    !Number.isFinite(parsed.expires_in) ||
    parsed.expires_in <= 0
  ) {
    throw new Error("pipedrive_oauth_invalid_response");
  }
  return {
    accessCredential: parsed.access_token,
    refreshCredential:
      typeof parsed.refresh_token === "string" && parsed.refresh_token.length > 0
        ? parsed.refresh_token
        : previousRefresh as string,
    expiresAtMs: now + Math.floor(parsed.expires_in) * 1_000,
    apiDomain: normalizePipedriveApiDomain(parsed.api_domain),
  };
}

function pipedriveSubdomainFromApiDomain(apiDomain: string): string {
  const hostname = new URL(apiDomain).hostname.toLowerCase();
  const suffix = ".pipedrive.com";
  if (!hostname.endsWith(suffix)) {
    throw new Error("tenant_domain_mismatch");
  }
  const subdomain = hostname.slice(0, -suffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain)) {
    throw new Error("tenant_domain_mismatch");
  }
  return subdomain;
}

function validateIdentity(accessSub: string, accessEmail: string): void {
  validateBounded(accessSub, 256, "access_token_invalid");
  validateBounded(accessEmail, 320, "access_token_invalid");
  if (!accessEmail.includes("@")) {
    throw new Error("access_token_invalid");
  }
}

function validateDomain(value: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) || value.length > 63) {
    throw new Error("tenant_domain_invalid");
  }
}

function validateRedirectUri(value: string): void {
  validateBounded(value, 2_048, "oauth_redirect_invalid");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("oauth_redirect_invalid");
  }
}

function validateOpaque(value: string): void {
  if (value.length < 16 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("user_connection_internal_error");
  }
}

function validateBounded(
  value: unknown,
  max: number,
  code: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(code);
  }
}

function boundedIdentifier(value: unknown, max: number, code: string): string {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) {
    throw new Error(code);
  }
  const result = String(value);
  if (result.length === 0 || result.length > max) {
    throw new Error(code);
  }
  return result;
}

function boundedLabel(value: unknown, max: number, code: string): string {
  if (typeof value !== "string") {
    throw new Error(code);
  }
  const result = value.trim().replace(/\s+/gu, " ");
  if (result.length === 0 || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new Error(code);
  }
  return result;
}

function connectionConfig(env: RemoteEnv): RemoteConfig {
  return {
    accessIssuer: "",
    accessAudience: "",
    adminEmail: "",
    pipedriveClientId: env.PIPEDRIVE_OAUTH_CLIENT_ID,
    pipedriveClientSecret: env.PIPEDRIVE_OAUTH_CLIENT_SECRET,
    encryptionKey: env.PIPEDRIVE_OAUTH_ENCRYPTION_KEY,
    auditHmacKey: env.AUDIT_HMAC_KEY,
  };
}

function sameEnvelope(
  left: EncryptedEnvelope | undefined,
  right: EncryptedEnvelope | undefined,
): boolean {
  return Boolean(left && right && left.v === right.v && left.iv === right.iv &&
    left.ciphertext === right.ciphertext);
}

function safeCode(error: unknown, fallback: string): string {
  return error instanceof Error && /^[a-z0-9_:.-]{1,100}$/.test(error.message)
    ? error.message
    : fallback;
}

function reportProjectionFailure(
  operation: "upsert" | "remove" | "reconnect-required",
  tenantId: string | undefined,
  error: unknown,
): void {
  console.warn(JSON.stringify({
    event: "tenant_admin_projection_failed",
    operation,
    ...(tenantId === undefined ? {} : { tenantId }),
    code: safeCode(error, "tenant_registry_unavailable"),
  }));
}

function connectionErrorStatus(code: string): number {
  if (code.includes("invalid") || code.includes("mismatch")) {
    return code.includes("state") ? 409 : 400;
  }
  if (code === "pipedrive_not_connected") {
    return 404;
  }
  if (code === "pipedrive_reconnect_required") {
    return 409;
  }
  if (code === "tenant_admission_denied") {
    return 403;
  }
  return 503;
}

async function requestJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error("user_connection_request_invalid");
  }
}

async function responseCode(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json<{ code?: unknown }>();
    return typeof body.code === "string" && /^[a-z0-9_:.-]{1,100}$/.test(body.code)
      ? body.code
      : fallback;
  } catch {
    return fallback;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
