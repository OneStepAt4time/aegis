import { describe, expect, it } from 'vitest';

import {
  ACP_REDIS_COORDINATION_RECOVERY_CONTRACT,
  AcpRedisCoordinationKeyError,
  RedisAcpRealtimeCoordinator,
  createAcpRedisCoordinationKeys,
  normalizeAcpRedisCoordinationKeyPrefix,
  type AcpRealtimeDisconnectInput,
} from '../services/acp/index.js';

describe('ACP Redis coordination contracts', () => {
  it('builds ADR-0028 keys from the public Aegis session id', () => {
    const keys = createAcpRedisCoordinationKeys();

    expect(keys.presence('session-abc_123')).toBe('aegis:acp:presence:session-abc_123');
    expect(keys.driverLock('session-abc_123')).toBe('aegis:acp:driver-lock:session-abc_123');
    expect(keys.driverLockFence('session-abc_123')).toBe(
      'aegis:acp:driver-lock-fence:session-abc_123'
    );
    expect(keys.events('session-abc_123')).toBe('aegis:acp:events:session-abc_123');
    expect(keys.wakeups()).toBe('aegis:acp:actions:wakeup');
    expect(keys.subscriberState('session-abc_123', 'subscriber-1')).toBe(
      'aegis:acp:subscriber-state:session-abc_123:subscriber-1'
    );
  });

  it('normalizes safe custom prefixes before composing keys', () => {
    expect(normalizeAcpRedisCoordinationKeyPrefix('  team-a:aegis:  ')).toBe('team-a:aegis');

    const keys = createAcpRedisCoordinationKeys({ keyPrefix: '  team-a:aegis:  ' });

    expect(keys.presence('session-1')).toBe('team-a:aegis:acp:presence:session-1');
  });

  it('rejects blank or unsafe Redis key prefixes', () => {
    const unsafePrefixes = ['', '   ', 'aegis::prod', 'aegis prod', 'aegis/prod', 'aegis\nprod'];

    for (const prefix of unsafePrefixes) {
      expect(() => normalizeAcpRedisCoordinationKeyPrefix(prefix)).toThrow(
        AcpRedisCoordinationKeyError
      );
    }
  });

  it('rejects blank public session ids and ids containing Redis separators', () => {
    const keys = createAcpRedisCoordinationKeys();
    const unsafeSessionIds = ['', '   ', 'session:1', 'session 1', 'session\n1'];

    for (const sessionId of unsafeSessionIds) {
      expect(() => keys.presence(sessionId)).toThrow(AcpRedisCoordinationKeyError);
      expect(() => keys.driverLock(sessionId)).toThrow(AcpRedisCoordinationKeyError);
      expect(() => keys.events(sessionId)).toThrow(AcpRedisCoordinationKeyError);
    }
  });

  it('rejects blank or unsafe subscriber ids for subscriber state keys', () => {
    const keys = createAcpRedisCoordinationKeys();

    expect(() => keys.subscriberState('session-1', '')).toThrow(AcpRedisCoordinationKeyError);
    expect(() => keys.subscriberState('session-1', 'subscriber:1')).toThrow(
      AcpRedisCoordinationKeyError
    );
  });

  it('does not expose ACP agent or JSON-RPC id helper names', () => {
    const keys = createAcpRedisCoordinationKeys();
    const helperNames = Object.entries(keys)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key);

    expect(helperNames.sort()).toEqual([
      'driverLock',
      'driverLockFence',
      'events',
      'presence',
      'subscriberState',
      'wakeups',
    ]);
    expect(helperNames.join('|')).not.toMatch(/acpAgent|jsonRpc|claudeSession|backendRun/i);
    expect(keys.driverLock('acp-agent-looking-id')).toBe(
      'aegis:acp:driver-lock:acp-agent-looking-id'
    );
    expect(keys.events('json-rpc-looking-id')).toBe('aegis:acp:events:json-rpc-looking-id');
  });

  it('documents Redis as volatile coordination recovered from durable stores', () => {
    expect(ACP_REDIS_COORDINATION_RECOVERY_CONTRACT.redisIsSourceOfTruth).toBe(false);
    expect(ACP_REDIS_COORDINATION_RECOVERY_CONTRACT.durableRecoverySources).toEqual([
      'postgres-event-replay',
      'postgres-action-queue',
    ]);
  });

  it('scopes disconnect driver-lock cleanup to the disconnecting session and subscriber', () => {
    const disconnect: AcpRealtimeDisconnectInput = {
      sessionId: 'session-1',
      subscriberId: 'subscriber-1',
      releaseDriverLock: {
        lockToken: 'lock-token-1',
        fencingToken: 7,
      },
    };

    expect(disconnect.releaseDriverLock).toEqual({
      lockToken: 'lock-token-1',
      fencingToken: 7,
    });

    const invalidDisconnect: AcpRealtimeDisconnectInput = {
      sessionId: 'session-1',
      subscriberId: 'subscriber-1',
      releaseDriverLock: {
        lockToken: 'lock-token-1',
        fencingToken: 7,
        // @ts-expect-error Disconnect cleanup must not target another session.
        sessionId: 'session-2',
      },
    };
    expect(invalidDisconnect.sessionId).toBe('session-1');
  });
});

describe('RedisAcpRealtimeCoordinator runtime', () => {
  it('records volatile presence heartbeats and prunes expired subscribers', async () => {
    const redis = new FakeRealtimeRedis();
    const keys = createAcpRedisCoordinationKeys();
    const coordinator = new RedisAcpRealtimeCoordinator({
      client: redis,
      keyPrefix: keys.prefix,
      now: () => redis.now,
      tokenGenerator: () => 'unused-lock-token',
    });

    const first = await coordinator.heartbeatPresence({
      sessionId: 'session-1',
      subscriberId: 'observer-1',
      role: 'observer',
      ttlMs: 1000,
      backendRunId: 'run-1',
      metadata: { nodeId: 'node-a' },
    });

    expect(first).toEqual({
      sessionId: 'session-1',
      subscriberId: 'observer-1',
      ttlMs: 1000,
      expiresAt: 2000,
      activeSubscriberCount: 1,
    });
    expect(redis.zscore(keys.presence('session-1'), 'observer-1')).toBe(2000);
    expect(redis.pttl(keys.presence('session-1'))).toBe(1000);
    expect(redis.readJsonObject(keys.subscriberState('session-1', 'observer-1'))).toMatchObject({
      sessionId: 'session-1',
      subscriberId: 'observer-1',
      role: 'observer',
      backendRunId: 'run-1',
      expiresAt: 2000,
    });

    redis.now = 2100;
    const second = await coordinator.heartbeatPresence({
      sessionId: 'session-1',
      subscriberId: 'observer-2',
      role: 'observer',
      ttlMs: 500,
    });

    expect(second.activeSubscriberCount).toBe(1);
    expect(redis.zscore(keys.presence('session-1'), 'observer-1')).toBeUndefined();
    expect(redis.zscore(keys.presence('session-1'), 'observer-2')).toBe(2600);
  });

  it('keeps the presence key alive until the longest active heartbeat expires', async () => {
    const redis = new FakeRealtimeRedis();
    const keys = createAcpRedisCoordinationKeys();
    const coordinator = new RedisAcpRealtimeCoordinator({
      client: redis,
      now: () => redis.now,
    });

    await coordinator.heartbeatPresence({
      sessionId: 'session-1',
      subscriberId: 'observer-long',
      role: 'observer',
      ttlMs: 5000,
    });
    redis.now = 1100;
    await coordinator.heartbeatPresence({
      sessionId: 'session-1',
      subscriberId: 'observer-short',
      role: 'observer',
      ttlMs: 500,
    });

    expect(redis.pttl(keys.presence('session-1'))).toBe(4900);
  });

  it('sets presence TTL atomically when concurrent heartbeats overlap', async () => {
    const redis = new FakeRealtimeRedis();
    const keys = createAcpRedisCoordinationKeys();
    const coordinator = new RedisAcpRealtimeCoordinator({
      client: redis,
      now: () => redis.now,
    });

    redis.deferFirstPexpireUntilAfterFollowingPexpire();
    const shorterHeartbeat = coordinator.heartbeatPresence({
      sessionId: 'session-1',
      subscriberId: 'observer-short',
      role: 'observer',
      ttlMs: 5000,
    });
    await redis.waitForDeferredPexpire();

    const longerHeartbeat = coordinator.heartbeatPresence({
      sessionId: 'session-1',
      subscriberId: 'observer-long',
      role: 'observer',
      ttlMs: 6000,
    });
    await longerHeartbeat;
    redis.releaseDeferredPexpire();
    await shorterHeartbeat;

    expect(redis.pttl(keys.presence('session-1'))).toBe(6000);
  });

  it('uses acquire-only monotonic fencing for driver locks across TTL expiry', async () => {
    const redis = new FakeRealtimeRedis();
    const coordinator = new RedisAcpRealtimeCoordinator({
      client: redis,
      now: () => redis.now,
      tokenGenerator: () => 'token-1',
    });

    const acquired = await coordinator.acquireDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-a',
      ttlMs: 1000,
    });

    expect(acquired.acquired).toBe(true);
    expect(acquired.lease).toMatchObject({
      sessionId: 'session-1',
      holderId: 'driver-a',
      lockToken: 'token-1',
      fencingToken: 1,
      ttlMs: 1000,
      expiresAt: 2000,
    });

    const blocked = await coordinator.acquireDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-b',
      ttlMs: 1000,
    });

    expect(blocked).toMatchObject({
      acquired: false,
      currentHolderId: 'driver-a',
      currentFencingToken: 1,
      expiresAt: 2000,
    });
    expect(redis.readCounter('aegis:acp:driver-lock-fence:session-1')).toBe(1);

    const renewed = await coordinator.renewDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-a',
      lockToken: 'token-1',
      fencingToken: 1,
      ttlMs: 2000,
    });

    expect(renewed.renewed).toBe(true);
    expect(renewed.lease?.fencingToken).toBe(1);
    expect(redis.readCounter('aegis:acp:driver-lock-fence:session-1')).toBe(1);

    await coordinator.releaseDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-a',
      lockToken: 'token-1',
      fencingToken: 1,
    });
    expect(redis.readCounter('aegis:acp:driver-lock-fence:session-1')).toBe(1);

    const reacquired = await coordinator.acquireDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-b',
      ttlMs: 1000,
    });

    expect(reacquired.acquired).toBe(true);
    expect(reacquired.lease?.fencingToken).toBe(2);
  });

  it('rejects stale renewals and releases without freeing a newer lease', async () => {
    const redis = new FakeRealtimeRedis();
    const coordinator = new RedisAcpRealtimeCoordinator({
      client: redis,
      now: () => redis.now,
      tokenGenerator: redis.nextToken,
    });

    const first = await coordinator.acquireDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-a',
      ttlMs: 1000,
    });
    expect(first.lease).toBeDefined();

    const staleRenewal = await coordinator.renewDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-a',
      lockToken: 'wrong-token',
      fencingToken: 1,
      ttlMs: 1000,
    });
    expect(staleRenewal).toEqual({ renewed: false, reason: 'token-mismatch' });

    redis.now = 2500;
    const second = await coordinator.acquireDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-b',
      ttlMs: 1000,
    });
    expect(second.lease).toMatchObject({
      holderId: 'driver-b',
      lockToken: 'token-2',
      fencingToken: 2,
    });

    await coordinator.releaseDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-a',
      lockToken: 'token-1',
      fencingToken: 1,
    });

    const blocked = await coordinator.acquireDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-c',
      ttlMs: 1000,
    });

    expect(blocked.acquired).toBe(false);
    expect(blocked.currentHolderId).toBe('driver-b');
    expect(blocked.currentFencingToken).toBe(2);
  });

  it('publishes event and worker wakeup messages and cleans subscriber state on close', async () => {
    const redis = new FakeRealtimeRedis();
    const keys = createAcpRedisCoordinationKeys();
    const coordinator = new RedisAcpRealtimeCoordinator({
      client: redis,
      subscriberClient: redis,
      now: () => redis.now,
    });

    const subscription = await coordinator.subscribeEventChannel({
      sessionId: 'session-1',
      subscriberId: 'observer-1',
      subscriberTtlMs: 1000,
      fromEventSeq: 41,
      metadata: { nodeId: 'node-a' },
    });

    expect(subscription.channelKey).toBe(keys.events('session-1'));
    expect(redis.subscribedChannels).toEqual([keys.events('session-1')]);
    expect(redis.readJsonObject(keys.subscriberState('session-1', 'observer-1'))).toMatchObject({
      sessionId: 'session-1',
      subscriberId: 'observer-1',
      fromEventSeq: 41,
      expiresAt: 2000,
    });

    await coordinator.publishEventNotification({
      sessionId: 'session-1',
      eventId: 'evt-1',
      eventSeq: 42,
      eventType: 'assistant.message',
      occurredAt: 1200,
      backendRunId: 'run-1',
      payload: { text: 'hello' },
    });
    await coordinator.wakeSleepingWorkers({
      reason: 'new-action',
      sessionId: 'session-1',
      actionId: 'action-1',
      actionType: 'prompt',
    });

    expect(redis.publishedMessages).toEqual([
      {
        channel: keys.events('session-1'),
        message: JSON.stringify({
          sessionId: 'session-1',
          eventId: 'evt-1',
          eventSeq: 42,
          eventType: 'assistant.message',
          occurredAt: 1200,
          backendRunId: 'run-1',
          payload: { text: 'hello' },
        }),
      },
      {
        channel: keys.wakeups(),
        message: JSON.stringify({
          reason: 'new-action',
          sessionId: 'session-1',
          actionId: 'action-1',
          actionType: 'prompt',
        }),
      },
    ]);

    await subscription.close();

    expect(redis.unsubscribedChannels).toEqual([keys.events('session-1')]);
    expect(redis.getSync(keys.subscriberState('session-1', 'observer-1'))).toBeNull();
  });

  it('disconnects volatile state and only releases the matching subscriber lock', async () => {
    const redis = new FakeRealtimeRedis();
    const keys = createAcpRedisCoordinationKeys();
    const coordinator = new RedisAcpRealtimeCoordinator({
      client: redis,
      now: () => redis.now,
      tokenGenerator: () => 'token-1',
    });

    await coordinator.heartbeatPresence({
      sessionId: 'session-1',
      subscriberId: 'driver-a',
      role: 'driver',
      ttlMs: 1000,
    });
    const lease = await coordinator.acquireDriverLock({
      sessionId: 'session-1',
      holderId: 'driver-a',
      ttlMs: 1000,
    });
    expect(lease.lease).toBeDefined();

    await coordinator.disconnect({
      sessionId: 'session-1',
      subscriberId: 'driver-a',
      releaseDriverLock: {
        lockToken: 'wrong-token',
        fencingToken: 1,
      },
    });

    expect(redis.zscore(keys.presence('session-1'), 'driver-a')).toBeUndefined();
    expect(redis.getSync(keys.subscriberState('session-1', 'driver-a'))).toBeNull();
    expect(redis.getSync(keys.driverLock('session-1'))).not.toBeNull();

    await coordinator.disconnect({
      sessionId: 'session-1',
      subscriberId: 'driver-a',
      releaseDriverLock: {
        lockToken: 'token-1',
        fencingToken: 1,
      },
    });

    expect(redis.getSync(keys.driverLock('session-1'))).toBeNull();
  });
});

interface StoredValue {
  value: string;
  expiresAt?: number;
}

interface PublishedMessage {
  channel: string;
  message: string;
}

class FakeRealtimeRedis {
  now = 1000;
  readonly publishedMessages: PublishedMessage[] = [];
  readonly subscribedChannels: string[] = [];
  readonly unsubscribedChannels: string[] = [];
  private readonly values = new Map<string, StoredValue>();
  private readonly expirations = new Map<string, number>();
  private readonly counters = new Map<string, number>();
  private readonly sortedSets = new Map<string, Map<string, number>>();
  private deferNextPexpire = false;
  private deferredPexpireRelease: (() => void) | undefined;
  private deferredPexpireStarted: Promise<void> | undefined;
  private resolveDeferredPexpireStarted: (() => void) | undefined;
  private tokenIndex = 0;

  readonly nextToken = (): string => {
    this.tokenIndex += 1;
    return `token-${this.tokenIndex}`;
  };

  deferFirstPexpireUntilAfterFollowingPexpire(): void {
    this.deferNextPexpire = true;
    this.deferredPexpireStarted = new Promise<void>(resolve => {
      this.resolveDeferredPexpireStarted = resolve;
    });
  }

  async waitForDeferredPexpire(): Promise<void> {
    if (!this.deferredPexpireStarted) {
      throw new Error('deferred pexpire was not configured');
    }
    await this.deferredPexpireStarted;
  }

  releaseDeferredPexpire(): void {
    if (this.deferredPexpireRelease) {
      this.deferredPexpireRelease();
    }
  }

  async get(key: string): Promise<string | null> {
    return this.getSync(key);
  }

  getSync(key: string): string | null {
    const entry = this.values.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ...options: Array<string | number>): Promise<'OK' | null> {
    const nx = options.some(option => option === 'NX');
    if (nx && this.getSync(key) !== null) {
      return null;
    }

    const pxIndex = options.findIndex(option => option === 'PX');
    const ttlMs = pxIndex >= 0 ? Number(options[pxIndex + 1]) : undefined;
    this.values.set(key, {
      value,
      expiresAt: ttlMs === undefined ? undefined : this.now + ttlMs,
    });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        deleted += 1;
      }
      if (this.sortedSets.delete(key)) {
        deleted += 1;
      }
      this.expirations.delete(key);
    }
    return deleted;
  }

  async pexpire(key: string, ttlMs: number): Promise<number> {
    if (this.deferNextPexpire) {
      this.deferNextPexpire = false;
      const release = new Promise<void>(resolve => {
        this.deferredPexpireRelease = resolve;
      });
      this.resolveDeferredPexpireStarted?.();
      await release;
    }
    return this.applyPexpire(key, ttlMs);
  }

  private applyPexpire(key: string, ttlMs: number): number {
    const entry = this.values.get(key);
    const sortedSet = this.sortedSets.get(key);
    if (!entry && !sortedSet) {
      return 0;
    }
    if (entry) {
      entry.expiresAt = this.now + ttlMs;
    }
    if (sortedSet) {
      this.expirations.set(key, this.now + ttlMs);
    }
    return 1;
  }

  pttl(key: string): number | undefined {
    const entry = this.values.get(key);
    if (!entry?.expiresAt) {
      const expiresAt = this.expirations.get(key);
      return expiresAt === undefined ? undefined : expiresAt - this.now;
    }
    return entry.expiresAt - this.now;
  }

  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  readCounter(key: string): number | undefined {
    return this.counters.get(key);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    let set = this.sortedSets.get(key);
    if (!set) {
      set = new Map<string, number>();
      this.sortedSets.set(key, set);
    }
    const existed = set.has(member);
    set.set(member, score);
    return existed ? 0 : 1;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) {
      return 0;
    }
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }
    return removed;
  }

  async zremrangebyscore(key: string, min: string | number, max: string | number): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) {
      return 0;
    }
    const minScore = Number(min);
    const maxScore = Number(max);
    let removed = 0;
    for (const [member, score] of set) {
      if (score >= minScore && score <= maxScore) {
        set.delete(member);
        removed += 1;
      }
    }
    return removed;
  }

  async zcard(key: string): Promise<number> {
    return this.sortedSets.get(key)?.size ?? 0;
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    withScores: 'WITHSCORES'
  ): Promise<string[]> {
    expect(withScores).toBe('WITHSCORES');
    const entries = [...(this.sortedSets.get(key)?.entries() ?? [])].sort(
      ([, leftScore], [, rightScore]) => leftScore - rightScore
    );
    const normalizedStart = start < 0 ? entries.length + start : start;
    const normalizedStop = stop < 0 ? entries.length + stop : stop;
    return entries
      .slice(normalizedStart, normalizedStop + 1)
      .flatMap(([member, score]) => [member, String(score)]);
  }

  zscore(key: string, member: string): number | undefined {
    return this.sortedSets.get(key)?.get(member);
  }

  async publish(channel: string, message: string): Promise<number> {
    this.publishedMessages.push({ channel, message });
    return 1;
  }

  async subscribe(channel: string): Promise<number> {
    this.subscribedChannels.push(channel);
    return this.subscribedChannels.length;
  }

  async unsubscribe(channel: string): Promise<number> {
    this.unsubscribedChannels.push(channel);
    return this.unsubscribedChannels.length;
  }

  async eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    if (numberOfKeys !== 2 && numberOfKeys !== 1) {
      throw new Error(`unexpected key count: ${numberOfKeys}`);
    }
    if (script.includes('ACP_DRIVER_LOCK_ACQUIRE')) {
      return this.evalAcquire(args);
    }
    if (script.includes('ACP_PRESENCE_HEARTBEAT')) {
      return this.evalPresenceHeartbeat(args);
    }
    if (script.includes('ACP_DRIVER_LOCK_RENEW')) {
      return this.evalRenew(args);
    }
    if (script.includes('ACP_DRIVER_LOCK_RELEASE')) {
      return this.evalRelease(args);
    }
    throw new Error('unknown script');
  }

  readJsonObject(key: string): Record<string, unknown> {
    const raw = this.getSync(key);
    if (raw === null) {
      throw new Error(`missing key ${key}`);
    }
    return parseJsonObject(raw);
  }

  private async evalAcquire(args: Array<string | number>): Promise<unknown[]> {
    const lockKey = String(args[0]);
    const fenceKey = String(args[1]);
    const basePayload = parseJsonObject(String(args[2]));
    const ttlMs = Number(args[3]);
    const expiresAt = Number(args[4]);
    const existing = await this.get(lockKey);
    if (existing !== null) {
      return [0, existing];
    }

    const fencingToken = await this.incr(fenceKey);
    const payload = JSON.stringify({ ...basePayload, fencingToken, ttlMs, expiresAt });
    await this.set(lockKey, payload, 'PX', ttlMs);
    return [1, payload];
  }

  private async evalPresenceHeartbeat(args: Array<string | number>): Promise<unknown[]> {
    const presenceKey = String(args[0]);
    const subscriberStateKey = String(args[1]);
    const now = Number(args[2]);
    const expiresAt = Number(args[3]);
    const subscriberId = String(args[4]);
    const subscriberPayload = String(args[5]);
    const subscriberTtlMs = Number(args[6]);

    if (this.deferNextPexpire) {
      this.deferNextPexpire = false;
      this.resolveDeferredPexpireStarted?.();
    }

    await this.zremrangebyscore(presenceKey, 0, now);
    await this.zadd(presenceKey, expiresAt, subscriberId);
    const latestPresence = await this.zrange(presenceKey, -1, -1, 'WITHSCORES');
    const latestExpiresAt = Number(latestPresence[1]);
    const presenceTtlMs = Number.isFinite(latestExpiresAt)
      ? Math.max(1, Math.ceil(latestExpiresAt - now))
      : subscriberTtlMs;
    this.applyPexpire(presenceKey, presenceTtlMs);
    this.values.set(subscriberStateKey, {
      value: subscriberPayload,
      expiresAt: this.now + subscriberTtlMs,
    });
    return [await this.zcard(presenceKey), presenceTtlMs];
  }

  private async evalRenew(args: Array<string | number>): Promise<unknown[]> {
    const lockKey = String(args[0]);
    const expectedHolderId = String(args[1]);
    const expectedLockToken = String(args[2]);
    const expectedFencingToken = Number(args[3]);
    const ttlMs = Number(args[4]);
    const expiresAt = Number(args[5]);
    const currentRaw = await this.get(lockKey);
    if (currentRaw === null) {
      return [0, 'expired'];
    }
    const current = parseJsonObject(currentRaw);
    if (current['holderId'] !== expectedHolderId) {
      return [0, 'not-holder'];
    }
    if (
      current['lockToken'] !== expectedLockToken ||
      current['fencingToken'] !== expectedFencingToken
    ) {
      return [0, 'token-mismatch'];
    }

    const payload = JSON.stringify({ ...current, ttlMs, expiresAt });
    await this.set(lockKey, payload, 'PX', ttlMs);
    return [1, payload];
  }

  private async evalRelease(args: Array<string | number>): Promise<number> {
    const lockKey = String(args[0]);
    const expectedHolderId = String(args[1]);
    const expectedLockToken = String(args[2]);
    const expectedFencingToken = Number(args[3]);
    const currentRaw = await this.get(lockKey);
    if (currentRaw === null) {
      return 0;
    }
    const current = parseJsonObject(currentRaw);
    if (
      current['holderId'] === expectedHolderId &&
      current['lockToken'] === expectedLockToken &&
      current['fencingToken'] === expectedFencingToken
    ) {
      await this.del(lockKey);
      return 1;
    }
    return 0;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (!isJsonRecord(parsed)) {
    throw new Error('expected JSON object');
  }
  return parsed;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
