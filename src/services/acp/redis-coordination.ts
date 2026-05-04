import { randomUUID } from 'node:crypto';

import type { AcpBackendMetadata, AcpControlActionType } from './types.js';

const DEFAULT_KEY_PREFIX = 'aegis';
const SAFE_REDIS_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export class AcpRedisCoordinationKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpRedisCoordinationKeyError';
  }
}

export class AcpRedisCoordinationRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpRedisCoordinationRuntimeError';
  }
}

export interface AcpRedisCoordinationKeyOptions {
  keyPrefix?: string;
}

export interface AcpRedisCoordinationKeys {
  readonly prefix: string;
  /** Presence key for the public Aegis session id, never ACP agent or JSON-RPC ids. */
  presence(publicSessionId: string): string;
  /** Driver lock key for the public Aegis session id, never ACP agent or JSON-RPC ids. */
  driverLock(publicSessionId: string): string;
  /** Per-session fencing counter key. This must not expire with the lock lease key. */
  driverLockFence(publicSessionId: string): string;
  /** Live event fanout key for the public Aegis session id, never ACP agent or JSON-RPC ids. */
  events(publicSessionId: string): string;
  wakeups(): string;
  /** Subscriber checkpoint/state key scoped by public Aegis session id and subscriber id. */
  subscriberState(publicSessionId: string, subscriberId: string): string;
}

export type AcpRedisCoordinationDurableRecoverySource =
  | 'postgres-event-replay'
  | 'postgres-action-queue';

export interface AcpRedisCoordinationRecoveryContract {
  readonly redisIsSourceOfTruth: false;
  readonly durableRecoverySources: readonly AcpRedisCoordinationDurableRecoverySource[];
  readonly summary: string;
}

export const ACP_REDIS_COORDINATION_RECOVERY_CONTRACT: AcpRedisCoordinationRecoveryContract = {
  redisIsSourceOfTruth: false,
  durableRecoverySources: ['postgres-event-replay', 'postgres-action-queue'],
  summary:
    'Redis coordination is volatile. Presence, driver locks, wakeups, and live fanout recover from durable Postgres event replay and action queue state.',
};

export function createAcpRedisCoordinationKeys(
  options: AcpRedisCoordinationKeyOptions = {}
): AcpRedisCoordinationKeys {
  const prefix = normalizeAcpRedisCoordinationKeyPrefix(options.keyPrefix ?? DEFAULT_KEY_PREFIX);

  return {
    prefix,
    presence(publicSessionId: string): string {
      return sessionScopedKey(prefix, 'presence', publicSessionId);
    },
    driverLock(publicSessionId: string): string {
      return sessionScopedKey(prefix, 'driver-lock', publicSessionId);
    },
    driverLockFence(publicSessionId: string): string {
      return sessionScopedKey(prefix, 'driver-lock-fence', publicSessionId);
    },
    events(publicSessionId: string): string {
      return sessionScopedKey(prefix, 'events', publicSessionId);
    },
    wakeups(): string {
      return `${prefix}:acp:actions:wakeup`;
    },
    subscriberState(publicSessionId: string, subscriberId: string): string {
      return `${prefix}:acp:subscriber-state:${validateAcpPublicSessionRedisKeyId(
        publicSessionId
      )}:${validateAcpRedisCoordinationSubscriberId(subscriberId)}`;
    },
  };
}

export function normalizeAcpRedisCoordinationKeyPrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/^:+|:+$/g, '');
  if (normalized === '') {
    throw new AcpRedisCoordinationKeyError('ACP Redis key prefix must be a non-empty string');
  }

  for (const segment of normalized.split(':')) {
    assertSafeRedisKeySegment(segment, 'Redis key prefix segment');
  }

  return normalized;
}

export function validateAcpPublicSessionRedisKeyId(publicSessionId: string): string {
  return normalizeSafeRedisKeySegment(publicSessionId, 'public Aegis session id');
}

export function validateAcpRedisCoordinationSubscriberId(subscriberId: string): string {
  return normalizeSafeRedisKeySegment(subscriberId, 'subscriber id');
}

export type AcpRealtimeSubscriberRole = 'driver' | 'observer' | 'worker' | 'system';

export interface AcpPresenceHeartbeatInput {
  sessionId: string;
  subscriberId: string;
  role: AcpRealtimeSubscriberRole;
  /** Presence records are volatile and must expire if heartbeats stop. */
  ttlMs: number;
  backendRunId?: string;
  metadata?: AcpBackendMetadata;
}

export interface AcpPresenceHeartbeatResult {
  sessionId: string;
  subscriberId: string;
  ttlMs: number;
  expiresAt: number;
  activeSubscriberCount?: number;
}

export interface AcpDriverLockAcquireInput {
  sessionId: string;
  holderId: string;
  /** Driver locks are leases and must be renewed before this TTL expires. */
  ttlMs: number;
  backendRunId?: string;
  metadata?: AcpBackendMetadata;
}

export interface AcpDriverLockLease {
  sessionId: string;
  holderId: string;
  /** Opaque ownership token that renew and release calls must present unchanged. */
  lockToken: string;
  /**
   * Monotonic per-public-session fencing token used to reject stale driver work.
   *
   * Implementations must allocate this from a counter that survives normal lock
   * TTL expiry within the same Redis epoch. Successful acquire advances the
   * counter; renew and release do not. Redis data loss may start a new epoch,
   * with durable recovery coming from Postgres event replay and action queue
   * state rather than Redis.
   */
  fencingToken: number;
  ttlMs: number;
  expiresAt: number;
}

export interface AcpDriverLockAcquireResult {
  acquired: boolean;
  lease?: AcpDriverLockLease;
  currentHolderId?: string;
  currentFencingToken?: number;
  expiresAt?: number;
}

export interface AcpDriverLockRenewInput {
  sessionId: string;
  holderId: string;
  /** Must match the active lease token; holder id alone is not sufficient. */
  lockToken: string;
  /** Must match the active fencing token so stale renewals fail closed. */
  fencingToken: number;
  ttlMs: number;
}

export type AcpDriverLockRenewResult =
  | {
      renewed: true;
      /**
       * The refreshed lease keeps the input fencing token unchanged.
       * Renewing a driver lock must not advance the per-session fence.
       */
      lease: AcpDriverLockLease;
    }
  | {
      renewed: false;
      reason: 'expired' | 'not-holder' | 'token-mismatch';
      lease?: never;
    };

export interface AcpDriverLockReleaseInput {
  sessionId: string;
  holderId: string;
  /** Must match the active lease token; release is not authorized by holder id alone. */
  lockToken: string;
  /** Must match the active fencing token so stale releases cannot free a new lease. */
  fencingToken: number;
}

export interface AcpRealtimeEventNotification {
  sessionId: string;
  eventId: string;
  eventSeq: number;
  eventType: string;
  occurredAt: number;
  backendRunId?: string;
  payload?: unknown;
}

export interface AcpEventSubscriptionInput {
  sessionId: string;
  subscriberId: string;
  /** Durable replay starts after this sequence before Redis live fanout catches up. */
  fromEventSeq?: number;
  /** Subscriber state is volatile and must expire if disconnect cleanup is missed. */
  subscriberTtlMs: number;
  metadata?: AcpBackendMetadata;
}

export interface AcpRealtimeSubscription {
  readonly sessionId: string;
  readonly subscriberId: string;
  readonly channelKey: string;
  close(): Promise<void>;
}

export interface AcpWakeSleepingWorkersInput {
  reason: 'new-action' | 'retry-ready' | 'driver-released' | 'shutdown';
  sessionId?: string;
  actionId?: string;
  actionType?: AcpControlActionType;
}

export interface AcpRealtimeDisconnectInput {
  sessionId: string;
  subscriberId: string;
  /**
   * Optional cleanup for a driver lock held by this same session/subscriber.
   *
   * Session and holder identity are intentionally inherited from sessionId and
   * subscriberId so disconnect cleanup cannot target another lock.
   */
  releaseDriverLock?: Pick<AcpDriverLockReleaseInput, 'lockToken' | 'fencingToken'>;
}

/**
 * Contract for Redis-backed realtime coordination.
 *
 * Implementations may use Redis for presence, driver-lock leases, wakeups, and
 * live fanout only. Redis loss is recovered through durable Postgres event
 * replay and action queue processing, not by treating Redis as source of truth.
 * Disconnect cleanup should clear volatile presence/subscriber state and may
 * release only the driver lock held by the disconnecting subscriber when the
 * supplied lock token and fencing token still match. TTL expiry remains the
 * fallback when disconnect cleanup is missed.
 */
export interface AcpRealtimeCoordinator {
  heartbeatPresence(input: AcpPresenceHeartbeatInput): Promise<AcpPresenceHeartbeatResult>;
  acquireDriverLock(input: AcpDriverLockAcquireInput): Promise<AcpDriverLockAcquireResult>;
  renewDriverLock(input: AcpDriverLockRenewInput): Promise<AcpDriverLockRenewResult>;
  releaseDriverLock(input: AcpDriverLockReleaseInput): Promise<void>;
  publishEventNotification(input: AcpRealtimeEventNotification): Promise<void>;
  subscribeEventChannel(input: AcpEventSubscriptionInput): Promise<AcpRealtimeSubscription>;
  wakeSleepingWorkers(input: AcpWakeSleepingWorkersInput): Promise<void>;
  disconnect(input: AcpRealtimeDisconnectInput): Promise<void>;
}

export interface AcpRedisRealtimeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...options: Array<string | number>): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  zrem(key: string, ...members: string[]): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface AcpRedisRealtimeSubscriberClient {
  subscribe(channel: string): Promise<number>;
  unsubscribe(channel: string): Promise<number>;
}

export interface RedisAcpRealtimeCoordinatorOptions extends AcpRedisCoordinationKeyOptions {
  client: AcpRedisRealtimeClient;
  subscriberClient?: AcpRedisRealtimeSubscriberClient;
  now?: () => number;
  tokenGenerator?: () => string;
}

const HEARTBEAT_PRESENCE_SCRIPT = `
-- ACP_PRESENCE_HEARTBEAT
local presenceKey = KEYS[1]
local subscriberStateKey = KEYS[2]
local now = tonumber(ARGV[1])
local expiresAt = tonumber(ARGV[2])
local subscriberId = ARGV[3]
local subscriberPayload = ARGV[4]
local subscriberTtlMs = tonumber(ARGV[5])
redis.call('ZREMRANGEBYSCORE', presenceKey, 0, now)
redis.call('ZADD', presenceKey, expiresAt, subscriberId)
local latestPresence = redis.call('ZRANGE', presenceKey, -1, -1, 'WITHSCORES')
local presenceTtlMs = subscriberTtlMs
if latestPresence[2] then
  presenceTtlMs = math.max(1, math.ceil(tonumber(latestPresence[2]) - now))
end
redis.call('PEXPIRE', presenceKey, presenceTtlMs)
redis.call('SET', subscriberStateKey, subscriberPayload, 'PX', subscriberTtlMs)
return {redis.call('ZCARD', presenceKey), presenceTtlMs}
`;

const ACQUIRE_DRIVER_LOCK_SCRIPT = `
-- ACP_DRIVER_LOCK_ACQUIRE
local lockKey = KEYS[1]
local fenceKey = KEYS[2]
local existing = redis.call('GET', lockKey)
if existing then
  return {0, existing}
end
local payload = cjson.decode(ARGV[1])
local fencingToken = redis.call('INCR', fenceKey)
payload['fencingToken'] = fencingToken
payload['ttlMs'] = tonumber(ARGV[2])
payload['expiresAt'] = tonumber(ARGV[3])
local encoded = cjson.encode(payload)
redis.call('PSETEX', lockKey, ARGV[2], encoded)
return {1, encoded}
`;

const RENEW_DRIVER_LOCK_SCRIPT = `
-- ACP_DRIVER_LOCK_RENEW
local lockKey = KEYS[1]
local existing = redis.call('GET', lockKey)
if not existing then
  return {0, 'expired'}
end
local payload = cjson.decode(existing)
if payload['holderId'] ~= ARGV[1] then
  return {0, 'not-holder'}
end
if payload['lockToken'] ~= ARGV[2] or tonumber(payload['fencingToken']) ~= tonumber(ARGV[3]) then
  return {0, 'token-mismatch'}
end
payload['ttlMs'] = tonumber(ARGV[4])
payload['expiresAt'] = tonumber(ARGV[5])
local encoded = cjson.encode(payload)
redis.call('PSETEX', lockKey, ARGV[4], encoded)
return {1, encoded}
`;

const RELEASE_DRIVER_LOCK_SCRIPT = `
-- ACP_DRIVER_LOCK_RELEASE
local lockKey = KEYS[1]
local existing = redis.call('GET', lockKey)
if not existing then
  return 0
end
local payload = cjson.decode(existing)
if payload['holderId'] == ARGV[1]
  and payload['lockToken'] == ARGV[2]
  and tonumber(payload['fencingToken']) == tonumber(ARGV[3]) then
  redis.call('DEL', lockKey)
  return 1
end
return 0
`;

export class RedisAcpRealtimeCoordinator implements AcpRealtimeCoordinator {
  private readonly client: AcpRedisRealtimeClient;
  private readonly subscriberClient: AcpRedisRealtimeSubscriberClient | undefined;
  private readonly keys: AcpRedisCoordinationKeys;
  private readonly now: () => number;
  private readonly tokenGenerator: () => string;

  constructor(options: RedisAcpRealtimeCoordinatorOptions) {
    this.client = options.client;
    this.subscriberClient = options.subscriberClient;
    this.keys = createAcpRedisCoordinationKeys({ keyPrefix: options.keyPrefix });
    this.now = options.now ?? Date.now;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
  }

  async heartbeatPresence(input: AcpPresenceHeartbeatInput): Promise<AcpPresenceHeartbeatResult> {
    assertPositiveTtl(input.ttlMs, 'presence heartbeat TTL');
    const sessionId = validateAcpPublicSessionRedisKeyId(input.sessionId);
    const subscriberId = validateAcpRedisCoordinationSubscriberId(input.subscriberId);
    const presenceKey = this.keys.presence(sessionId);
    const subscriberStateKey = this.keys.subscriberState(sessionId, subscriberId);
    const now = this.now();
    const expiresAt = now + input.ttlMs;
    const result = toRedisEvalTuple(
      await this.client.eval(
        HEARTBEAT_PRESENCE_SCRIPT,
        2,
        presenceKey,
        subscriberStateKey,
        now,
        expiresAt,
        subscriberId,
        JSON.stringify(buildPresencePayload(input, sessionId, subscriberId, expiresAt)),
        input.ttlMs
      ),
      'presence heartbeat'
    );

    return {
      sessionId,
      subscriberId,
      ttlMs: input.ttlMs,
      expiresAt,
      activeSubscriberCount: numberAt(result, 0, 'presence heartbeat active count'),
    };
  }

  async acquireDriverLock(input: AcpDriverLockAcquireInput): Promise<AcpDriverLockAcquireResult> {
    assertPositiveTtl(input.ttlMs, 'driver lock TTL');
    const sessionId = validateAcpPublicSessionRedisKeyId(input.sessionId);
    const holderId = validateAcpRedisCoordinationSubscriberId(input.holderId);
    const ttlMs = input.ttlMs;
    const expiresAt = this.now() + ttlMs;
    const basePayload = buildDriverLockBasePayload(
      input,
      sessionId,
      holderId,
      this.tokenGenerator()
    );
    const result = toRedisEvalTuple(
      await this.client.eval(
        ACQUIRE_DRIVER_LOCK_SCRIPT,
        2,
        this.keys.driverLock(sessionId),
        this.keys.driverLockFence(sessionId),
        JSON.stringify(basePayload),
        ttlMs,
        expiresAt
      ),
      'driver lock acquire'
    );

    const payload = stringAt(result, 1, 'driver lock acquire payload');
    const lease = parseDriverLockLease(payload);
    if (redisFlagAt(result, 0, 'driver lock acquire flag')) {
      return { acquired: true, lease };
    }

    return {
      acquired: false,
      currentHolderId: lease.holderId,
      currentFencingToken: lease.fencingToken,
      expiresAt: lease.expiresAt,
    };
  }

  async renewDriverLock(input: AcpDriverLockRenewInput): Promise<AcpDriverLockRenewResult> {
    assertPositiveTtl(input.ttlMs, 'driver lock renewal TTL');
    const sessionId = validateAcpPublicSessionRedisKeyId(input.sessionId);
    const holderId = validateAcpRedisCoordinationSubscriberId(input.holderId);
    const result = toRedisEvalTuple(
      await this.client.eval(
        RENEW_DRIVER_LOCK_SCRIPT,
        1,
        this.keys.driverLock(sessionId),
        holderId,
        input.lockToken,
        input.fencingToken,
        input.ttlMs,
        this.now() + input.ttlMs
      ),
      'driver lock renew'
    );

    if (redisFlagAt(result, 0, 'driver lock renew flag')) {
      return {
        renewed: true,
        lease: parseDriverLockLease(stringAt(result, 1, 'driver lock renew payload')),
      };
    }

    return {
      renewed: false,
      reason: renewReasonAt(result, 1),
    };
  }

  async releaseDriverLock(input: AcpDriverLockReleaseInput): Promise<void> {
    const sessionId = validateAcpPublicSessionRedisKeyId(input.sessionId);
    const holderId = validateAcpRedisCoordinationSubscriberId(input.holderId);
    await this.client.eval(
      RELEASE_DRIVER_LOCK_SCRIPT,
      1,
      this.keys.driverLock(sessionId),
      holderId,
      input.lockToken,
      input.fencingToken
    );
  }

  async publishEventNotification(input: AcpRealtimeEventNotification): Promise<void> {
    const sessionId = validateAcpPublicSessionRedisKeyId(input.sessionId);
    await this.client.publish(this.keys.events(sessionId), JSON.stringify(input));
  }

  async subscribeEventChannel(input: AcpEventSubscriptionInput): Promise<AcpRealtimeSubscription> {
    assertPositiveTtl(input.subscriberTtlMs, 'event subscriber TTL');
    const subscriberClient = this.requireSubscriberClient();
    const sessionId = validateAcpPublicSessionRedisKeyId(input.sessionId);
    const subscriberId = validateAcpRedisCoordinationSubscriberId(input.subscriberId);
    const channelKey = this.keys.events(sessionId);
    const subscriberStateKey = this.keys.subscriberState(sessionId, subscriberId);
    const expiresAt = this.now() + input.subscriberTtlMs;

    await this.client.set(
      subscriberStateKey,
      JSON.stringify(buildSubscriberPayload(input, sessionId, subscriberId, expiresAt)),
      'PX',
      input.subscriberTtlMs
    );
    await subscriberClient.subscribe(channelKey);

    let closed = false;
    return {
      sessionId,
      subscriberId,
      channelKey,
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        await subscriberClient.unsubscribe(channelKey);
        await this.client.del(subscriberStateKey);
      },
    };
  }

  async wakeSleepingWorkers(input: AcpWakeSleepingWorkersInput): Promise<void> {
    await this.client.publish(this.keys.wakeups(), JSON.stringify(input));
  }

  async disconnect(input: AcpRealtimeDisconnectInput): Promise<void> {
    const sessionId = validateAcpPublicSessionRedisKeyId(input.sessionId);
    const subscriberId = validateAcpRedisCoordinationSubscriberId(input.subscriberId);
    await this.client.zrem(this.keys.presence(sessionId), subscriberId);
    await this.client.del(this.keys.subscriberState(sessionId, subscriberId));

    if (input.releaseDriverLock) {
      await this.releaseDriverLock({
        sessionId,
        holderId: subscriberId,
        lockToken: input.releaseDriverLock.lockToken,
        fencingToken: input.releaseDriverLock.fencingToken,
      });
    }
  }

  private requireSubscriberClient(): AcpRedisRealtimeSubscriberClient {
    if (this.subscriberClient) {
      return this.subscriberClient;
    }
    if (isAcpRedisRealtimeSubscriberClient(this.client)) {
      return this.client;
    }
    throw new AcpRedisCoordinationRuntimeError(
      'ACP Redis pub/sub requires a Redis client with subscribe and unsubscribe support'
    );
  }
}

function buildPresencePayload(
  input: AcpPresenceHeartbeatInput,
  sessionId: string,
  subscriberId: string,
  expiresAt: number
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sessionId,
    subscriberId,
    role: input.role,
    ttlMs: input.ttlMs,
    expiresAt,
  };
  addOptionalString(payload, 'backendRunId', input.backendRunId);
  addOptionalMetadata(payload, input.metadata);
  return payload;
}

function buildDriverLockBasePayload(
  input: AcpDriverLockAcquireInput,
  sessionId: string,
  holderId: string,
  lockToken: string
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sessionId,
    holderId,
    lockToken,
  };
  addOptionalString(payload, 'backendRunId', input.backendRunId);
  addOptionalMetadata(payload, input.metadata);
  return payload;
}

function buildSubscriberPayload(
  input: AcpEventSubscriptionInput,
  sessionId: string,
  subscriberId: string,
  expiresAt: number
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    sessionId,
    subscriberId,
    subscriberTtlMs: input.subscriberTtlMs,
    expiresAt,
  };
  if (input.fromEventSeq !== undefined) {
    payload['fromEventSeq'] = input.fromEventSeq;
  }
  addOptionalMetadata(payload, input.metadata);
  return payload;
}

function addOptionalString(
  payload: Record<string, unknown>,
  key: string,
  value: string | undefined
): void {
  if (value !== undefined) {
    payload[key] = value;
  }
}

function addOptionalMetadata(
  payload: Record<string, unknown>,
  metadata: AcpBackendMetadata | undefined
): void {
  if (metadata !== undefined) {
    payload['metadata'] = metadata;
  }
}

function assertPositiveTtl(ttlMs: number, label: string): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new AcpRedisCoordinationRuntimeError(`ACP Redis ${label} must be a positive integer`);
  }
}

function isAcpRedisRealtimeSubscriberClient(
  client: AcpRedisRealtimeClient
): client is AcpRedisRealtimeClient & AcpRedisRealtimeSubscriberClient {
  return (
    'subscribe' in client &&
    typeof client.subscribe === 'function' &&
    'unsubscribe' in client &&
    typeof client.unsubscribe === 'function'
  );
}

function parseDriverLockLease(raw: string): AcpDriverLockLease {
  const payload = parseJsonObject(raw, 'driver lock payload');
  return {
    sessionId: requiredString(payload, 'sessionId', 'driver lock payload'),
    holderId: requiredString(payload, 'holderId', 'driver lock payload'),
    lockToken: requiredString(payload, 'lockToken', 'driver lock payload'),
    fencingToken: requiredNumber(payload, 'fencingToken', 'driver lock payload'),
    ttlMs: requiredNumber(payload, 'ttlMs', 'driver lock payload'),
    expiresAt: requiredNumber(payload, 'expiresAt', 'driver lock payload'),
  };
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonRecord(parsed)) {
    throw new AcpRedisCoordinationRuntimeError(`ACP Redis ${label} must be a JSON object`);
  }
  return parsed;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(payload: Record<string, unknown>, field: string, label: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value === '') {
    throw new AcpRedisCoordinationRuntimeError(
      `ACP Redis ${label} field ${field} must be a string`
    );
  }
  return value;
}

function requiredNumber(payload: Record<string, unknown>, field: string, label: string): number {
  const value = payload[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AcpRedisCoordinationRuntimeError(
      `ACP Redis ${label} field ${field} must be a number`
    );
  }
  return value;
}

function toRedisEvalTuple(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new AcpRedisCoordinationRuntimeError(
      `ACP Redis ${label} script returned a non-array result`
    );
  }
  return value;
}

function redisFlagAt(values: readonly unknown[], index: number, label: string): boolean {
  const value = values[index];
  if (value === 1 || value === '1') {
    return true;
  }
  if (value === 0 || value === '0') {
    return false;
  }
  throw new AcpRedisCoordinationRuntimeError(`ACP Redis ${label} must be 0 or 1`);
}

function stringAt(values: readonly unknown[], index: number, label: string): string {
  const value = values[index];
  if (typeof value !== 'string') {
    throw new AcpRedisCoordinationRuntimeError(`ACP Redis ${label} must be a string`);
  }
  return value;
}

function numberAt(values: readonly unknown[], index: number, label: string): number {
  const value = values[index];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new AcpRedisCoordinationRuntimeError(`ACP Redis ${label} must be a number`);
}

function renewReasonAt(
  values: readonly unknown[],
  index: number
): 'expired' | 'not-holder' | 'token-mismatch' {
  const value = values[index];
  if (value === 'expired' || value === 'not-holder' || value === 'token-mismatch') {
    return value;
  }
  throw new AcpRedisCoordinationRuntimeError(
    'ACP Redis driver lock renew returned an unknown reason'
  );
}

function sessionScopedKey(prefix: string, kind: string, publicSessionId: string): string {
  return `${prefix}:acp:${kind}:${validateAcpPublicSessionRedisKeyId(publicSessionId)}`;
}

function normalizeSafeRedisKeySegment(value: string, label: string): string {
  if (typeof value !== 'string') {
    throw new AcpRedisCoordinationKeyError(`ACP Redis ${label} must be a string`);
  }

  const normalized = value.trim();
  if (normalized === '') {
    throw new AcpRedisCoordinationKeyError(`ACP Redis ${label} must be a non-empty string`);
  }

  if (normalized !== value || !SAFE_REDIS_KEY_SEGMENT_PATTERN.test(value)) {
    throw new AcpRedisCoordinationKeyError(
      `ACP Redis ${label} contains characters unsafe for key composition`
    );
  }

  return value;
}

function assertSafeRedisKeySegment(segment: string, label: string): void {
  if (segment === '' || !SAFE_REDIS_KEY_SEGMENT_PATTERN.test(segment)) {
    throw new AcpRedisCoordinationKeyError(
      `ACP Redis ${label} contains characters unsafe for key composition`
    );
  }
}
