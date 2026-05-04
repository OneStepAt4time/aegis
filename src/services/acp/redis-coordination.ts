import type { AcpBackendMetadata, AcpControlActionType } from './types.js';

const DEFAULT_KEY_PREFIX = 'aegis';
const SAFE_REDIS_KEY_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

export class AcpRedisCoordinationKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpRedisCoordinationKeyError';
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

export interface AcpDriverLockRenewResult {
  renewed: boolean;
  lease?: AcpDriverLockLease;
  reason?: 'expired' | 'not-holder' | 'token-mismatch';
}

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
 * Contract for future Redis-backed realtime coordination.
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
