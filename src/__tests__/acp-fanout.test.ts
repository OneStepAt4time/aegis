import { describe, expect, it } from 'vitest';

import {
  ACP_FANOUT_VOLATILITY_CONTRACT,
  LocalAcpFanout,
  RedisAcpFanout,
  createMemoryAcpLocalStorageProfile,
  type AcpAppendEventInput,
  type AcpEventRecord,
  type AcpEventStore,
  type AcpFanoutDelivery,
  type AcpFanoutRedisAdapter,
  type AcpFanoutRedisNotification,
  type AcpFanoutRedisSubscription,
  type AcpSessionScope,
} from '../services/acp/index.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-1',
  ownerKeyId: 'owner-1',
};

const otherScope: AcpSessionScope = {
  tenantId: 'tenant-2',
  ownerKeyId: 'owner-2',
};

function eventInput(overrides: Partial<AcpAppendEventInput> = {}): AcpAppendEventInput {
  return {
    ...scope,
    sessionId: 'session-1',
    backendRunId: 'run-1',
    eventType: 'message.delta',
    occurredAt: new Date('2026-01-02T03:04:05.000Z'),
    payload: { text: 'hello' },
    ...overrides,
  };
}

function deliverySeqs(deliveries: AcpFanoutDelivery[]): number[] {
  return deliveries.map(delivery => delivery.event.eventSeq);
}

describe('LocalAcpFanout', () => {
  it('subscribes, delivers ordered live events, and stops delivery after unsubscribe', async () => {
    const fanout = new LocalAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
    });
    const deliveries: AcpFanoutDelivery[] = [];

    const subscription = await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        deliveries.push(delivery);
      }
    );

    const first = await fanout.publish(eventInput({ payload: { index: 1 } }));
    const second = await fanout.publish(eventInput({ payload: { index: 2 } }));
    await subscription.close();
    await fanout.publish(eventInput({ payload: { index: 3 } }));

    expect([first.eventSeq, second.eventSeq]).toEqual([1, 2]);
    expect(deliveries).toMatchObject([
      { source: 'live', event: { eventSeq: 1, payload: { index: 1 } } },
      { source: 'live', event: { eventSeq: 2, payload: { index: 2 } } },
    ]);
    expect(fanout.subscriberCount({ ...scope, sessionId: 'session-1' })).toBe(0);
  });

  it('hands off durable replay to live delivery without gaps or reordered events', async () => {
    const eventStore = new BlockingListEventStore(createMemoryAcpLocalStorageProfile().eventStore);
    const fanout = new LocalAcpFanout({ eventStore });
    const deliveries: AcpFanoutDelivery[] = [];

    await fanout.publish(eventInput({ payload: { index: 1 } }));
    await fanout.publish(eventInput({ payload: { index: 2 } }));

    const subscribePromise = fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1', afterEventSeq: 1 },
      delivery => {
        deliveries.push(delivery);
      }
    );
    await eventStore.waitForBlockedList();

    const thirdPublish = fanout.publish(eventInput({ payload: { index: 3 } }));
    eventStore.releaseBlockedList();
    await subscribePromise;
    await thirdPublish;

    expect(deliverySeqs(deliveries)).toEqual([2, 3]);
    expect(deliveries).toMatchObject([
      { event: { eventSeq: 2, payload: { index: 2 } } },
      { event: { eventSeq: 3, payload: { index: 3 } } },
    ]);
  });

  it('pages durable replay until the subscriber catches up to the stored cursor', async () => {
    const fanout = new LocalAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
    });
    const deliveries: AcpFanoutDelivery[] = [];

    for (let index = 1; index <= 5; index += 1) {
      await fanout.publish(eventInput({ payload: { index } }));
    }
    await fanout.subscribe(
      {
        ...scope,
        sessionId: 'session-1',
        subscriberId: 'observer-1',
        afterEventSeq: 0,
        replayLimit: 2,
      },
      delivery => {
        deliveries.push(delivery);
      }
    );

    expect(deliverySeqs(deliveries)).toEqual([1, 2, 3, 4, 5]);
    expect(deliveries.every(delivery => delivery.source === 'replay')).toBe(true);
  });

  it('does not interleave live delivery ahead of queued handoff events', async () => {
    const eventStore = new BlockingListEventStore(createMemoryAcpLocalStorageProfile().eventStore);
    const fanout = new LocalAcpFanout({ eventStore });
    const deliveries: AcpFanoutDelivery[] = [];
    let signalThirdDelivery: (() => void) | undefined;
    let unblockThirdDelivery: (() => void) | undefined;
    const thirdDeliveryStarted = new Promise<void>(resolve => {
      signalThirdDelivery = resolve;
    });
    const thirdDeliveryCanFinish = new Promise<void>(resolve => {
      unblockThirdDelivery = resolve;
    });

    await fanout.publish(eventInput({ payload: { index: 1 } }));
    await fanout.publish(eventInput({ payload: { index: 2 } }));
    const subscribePromise = fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1', afterEventSeq: 1 },
      async delivery => {
        deliveries.push(delivery);
        if (delivery.event.eventSeq === 3) {
          signalThirdDelivery?.();
          await thirdDeliveryCanFinish;
        }
      }
    );
    await eventStore.waitForBlockedList();

    const thirdPublish = fanout.publish(eventInput({ payload: { index: 3 } }));
    const fourthPublish = fanout.publish(eventInput({ payload: { index: 4 } }));
    eventStore.releaseBlockedList();
    await thirdDeliveryStarted;
    const fifthPublish = fanout.publish(eventInput({ payload: { index: 5 } }));
    unblockThirdDelivery?.();
    await subscribePromise;
    await Promise.all([thirdPublish, fourthPublish, fifthPublish]);

    expect(deliverySeqs(deliveries)).toEqual([2, 3, 4, 5]);
  });

  it('keeps delivery scoped by public session, tenant, and owner', async () => {
    const fanout = new LocalAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
    });
    const deliveries: AcpFanoutDelivery[] = [];

    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        deliveries.push(delivery);
      }
    );

    await fanout.publish(eventInput({ sessionId: 'session-2', payload: { session: 2 } }));
    await fanout.publish({
      ...eventInput({ sessionId: 'session-3', payload: { tenant: 2 } }),
      ...otherScope,
    });
    await fanout.publish(eventInput({ payload: { session: 1 } }));

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].event).toMatchObject({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      payload: { session: 1 },
    });
  });

  it('delivers unknown mapped event types once and ignores duplicate stored notifications', async () => {
    const fanout = new LocalAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
    });
    const deliveries: AcpFanoutDelivery[] = [];

    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        deliveries.push(delivery);
      }
    );

    const unknown = await fanout.publish(
      eventInput({
        eventType: 'acp.unsupported',
        payload: { reason: 'unsupported_session_update', acpUpdateType: 'mystery_update' },
      })
    );
    await fanout.deliverStoredEvent(unknown, 'live');

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      source: 'live',
      event: {
        eventSeq: 1,
        eventType: 'acp.unsupported',
        payload: { reason: 'unsupported_session_update', acpUpdateType: 'mystery_update' },
      },
    });
  });
});

describe('RedisAcpFanout', () => {
  it('publishes volatile Redis hints while local subscribers receive durable records', async () => {
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
      redis,
    });
    const deliveries: AcpFanoutDelivery[] = [];

    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        deliveries.push(delivery);
      }
    );
    const stored = await fanout.publish(eventInput({ payload: { text: 'hello via redis' } }));

    expect(deliveries).toMatchObject([
      { source: 'live', event: { eventSeq: 1, payload: { text: 'hello via redis' } } },
    ]);
    expect(redis.published).toEqual([
      {
        sessionId: 'session-1',
        tenantId: 'tenant-1',
        ownerKeyId: 'owner-1',
        eventId: stored.eventId,
        eventSeq: 1,
        eventType: 'message.delta',
      },
    ]);
  });

  it('uses Redis notifications as volatile wakeups and replays from the durable store', async () => {
    const eventStore = createMemoryAcpLocalStorageProfile().eventStore;
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({ eventStore, redis });
    const deliveries: AcpFanoutDelivery[] = [];

    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1', afterEventSeq: 0 },
      delivery => {
        deliveries.push(delivery);
      }
    );

    const stored = await eventStore.append(eventInput({ payload: { from: 'other-node' } }));
    await redis.emit({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      eventId: stored.eventId,
      eventSeq: stored.eventSeq,
      eventType: stored.eventType,
    });

    expect(deliveries).toMatchObject([
      { source: 'redis', event: { eventSeq: 1, payload: { from: 'other-node' } } },
    ]);
  });

  it('closes the Redis replay gap between durable catch-up and subscription registration', async () => {
    const eventStore = createMemoryAcpLocalStorageProfile().eventStore;
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({ eventStore, redis });
    const deliveries: AcpFanoutDelivery[] = [];

    await eventStore.append(eventInput({ payload: { index: 1 } }));
    redis.beforeSubscribeRegister = async (): Promise<void> => {
      await eventStore.append(eventInput({ payload: { index: 2 } }));
    };
    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1', afterEventSeq: 0 },
      delivery => {
        deliveries.push(delivery);
      }
    );

    expect(deliverySeqs(deliveries)).toEqual([1, 2]);
  });

  it('uses later Redis notifications to recover earlier missed volatile hints', async () => {
    const eventStore = createMemoryAcpLocalStorageProfile().eventStore;
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({ eventStore, redis });
    const deliveries: AcpFanoutDelivery[] = [];

    await eventStore.append(eventInput({ payload: { index: 1 } }));
    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1', afterEventSeq: 0 },
      delivery => {
        deliveries.push(delivery);
      }
    );
    await eventStore.append(eventInput({ payload: { index: 2 } }));
    const third = await eventStore.append(eventInput({ payload: { index: 3 } }));

    await redis.emit({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      eventId: third.eventId,
      eventSeq: third.eventSeq,
      eventType: third.eventType,
    });

    expect(deliverySeqs(deliveries)).toEqual([1, 2, 3]);
  });

  it('deduplicates repeated Redis notifications and still delivers unknown event types', async () => {
    const eventStore = createMemoryAcpLocalStorageProfile().eventStore;
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({ eventStore, redis });
    const deliveries: AcpFanoutDelivery[] = [];

    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        deliveries.push(delivery);
      }
    );
    const stored = await eventStore.append(
      eventInput({
        eventType: 'acp.unsupported',
        payload: { reason: 'unsupported_session_update' },
      })
    );
    const notification: AcpFanoutRedisNotification = {
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      eventId: stored.eventId,
      eventSeq: stored.eventSeq,
      eventType: stored.eventType,
    };

    await redis.emit(notification);
    await redis.emit(notification);

    expect(deliverySeqs(deliveries)).toEqual([1]);
    expect(deliveries[0]).toMatchObject({
      source: 'redis',
      event: { eventType: 'acp.unsupported', payload: { reason: 'unsupported_session_update' } },
    });
  });

  it('serializes concurrent Redis catch-up handlers for each subscriber', async () => {
    const eventStore = createMemoryAcpLocalStorageProfile().eventStore;
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({ eventStore, redis });
    const deliveries: number[] = [];
    let secondStarted: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    let overlapped = false;
    let inHandler = false;
    const secondDeliveryStarted = new Promise<void>(resolve => {
      secondStarted = resolve;
    });
    const secondDeliveryCanFinish = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });

    await eventStore.append(eventInput({ payload: { index: 1 } }));
    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1', afterEventSeq: 0 },
      async delivery => {
        if (inHandler) {
          overlapped = true;
        }
        inHandler = true;
        deliveries.push(delivery.event.eventSeq);
        if (delivery.event.eventSeq === 2) {
          secondStarted?.();
          await secondDeliveryCanFinish;
        }
        inHandler = false;
      }
    );
    const second = await eventStore.append(eventInput({ payload: { index: 2 } }));
    const third = await eventStore.append(eventInput({ payload: { index: 3 } }));

    const secondEmit = redis.emit({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      eventId: second.eventId,
      eventSeq: second.eventSeq,
      eventType: second.eventType,
    });
    await secondDeliveryStarted;
    const thirdEmit = redis.emit({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      eventId: third.eventId,
      eventSeq: third.eventSeq,
      eventType: third.eventType,
    });
    releaseSecond?.();
    await Promise.all([secondEmit, thirdEmit]);

    expect(overlapped).toBe(false);
    expect(deliveries).toEqual([1, 2, 3]);
  });

  it('ignores Redis notifications whose tenant or owner scope does not match', async () => {
    const eventStore = createMemoryAcpLocalStorageProfile().eventStore;
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({ eventStore, redis });
    const deliveries: AcpFanoutDelivery[] = [];

    const stored = await eventStore.append(eventInput({ payload: { scoped: true } }));
    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        deliveries.push(delivery);
      }
    );

    await redis.emit({
      sessionId: 'session-1',
      tenantId: 'tenant-2',
      ownerKeyId: 'owner-1',
      eventId: stored.eventId,
      eventSeq: stored.eventSeq,
      eventType: stored.eventType,
    });
    await redis.emit({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-2',
      eventId: stored.eventId,
      eventSeq: stored.eventSeq,
      eventType: stored.eventType,
    });
    await redis.emit({
      sessionId: 'session-1',
      tenantId: 'tenant-1',
      ownerKeyId: 'owner-1',
      eventId: stored.eventId,
      eventSeq: stored.eventSeq,
      eventType: stored.eventType,
    });

    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].event.payload).toEqual({ scoped: true });
  });

  it('isolates subscriber handler failures from durable append, other subscribers, and Redis hints', async () => {
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
      redis,
    });
    const healthyDeliveries: AcpFanoutDelivery[] = [];

    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'broken-observer' },
      () => {
        throw new Error('observer disconnected');
      }
    );
    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'healthy-observer' },
      delivery => {
        healthyDeliveries.push(delivery);
      }
    );
    const stored = await fanout.publish(eventInput({ payload: { handler: 'throws' } }));

    expect(stored.eventSeq).toBe(1);
    expect(healthyDeliveries).toMatchObject([
      { source: 'live', event: { eventSeq: 1, payload: { handler: 'throws' } } },
    ]);
    expect(redis.published).toHaveLength(1);
    expect(fanout.subscriberCount({ ...scope, sessionId: 'session-1' })).toBe(1);
  });

  it('does not let a stale same-id subscription close the active replacement', async () => {
    const fanout = new LocalAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
    });
    const activeDeliveries: AcpFanoutDelivery[] = [];

    const stale = await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      () => {}
    );
    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        activeDeliveries.push(delivery);
      }
    );
    await stale.close();
    await fanout.publish(eventInput({ payload: { active: true } }));

    expect(activeDeliveries).toHaveLength(1);
    expect(fanout.subscriberCount({ ...scope, sessionId: 'session-1' })).toBe(1);
  });

  it('closes Redis subscriptions on disconnect and recovers missed volatile events from replay', async () => {
    const eventStore = createMemoryAcpLocalStorageProfile().eventStore;
    const redis = new FakeFanoutRedisAdapter();
    const fanout = new RedisAcpFanout({ eventStore, redis });

    const firstSubscription = await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      () => {}
    );
    await firstSubscription.close();

    const missed = await eventStore.append(eventInput({ payload: { missed: true } }));
    const replayed: AcpFanoutDelivery[] = [];
    await fanout.subscribe(
      {
        ...scope,
        sessionId: 'session-1',
        subscriberId: 'observer-2',
        afterEventSeq: missed.eventSeq - 1,
      },
      delivery => {
        replayed.push(delivery);
      }
    );

    expect(redis.closedSubscriptions).toEqual(['session-1:observer-1']);
    expect(replayed).toMatchObject([
      { source: 'replay', event: { eventSeq: 1, payload: { missed: true } } },
    ]);
    expect(ACP_FANOUT_VOLATILITY_CONTRACT.redisIsSourceOfTruth).toBe(false);
    expect(ACP_FANOUT_VOLATILITY_CONTRACT.durableRecoverySources).toEqual([
      'postgres-event-replay',
    ]);
  });

  it('keeps durable append success when volatile Redis publish fails', async () => {
    const redis = new FakeFanoutRedisAdapter();
    redis.failPublish = true;
    const fanout = new RedisAcpFanout({
      eventStore: createMemoryAcpLocalStorageProfile().eventStore,
      redis,
    });
    const deliveries: AcpFanoutDelivery[] = [];

    await fanout.subscribe(
      { ...scope, sessionId: 'session-1', subscriberId: 'observer-1' },
      delivery => {
        deliveries.push(delivery);
      }
    );
    const stored = await fanout.publish(eventInput({ payload: { redis: 'down' } }));

    expect(stored.eventSeq).toBe(1);
    expect(deliveries).toMatchObject([
      { source: 'live', event: { eventSeq: 1, payload: { redis: 'down' } } },
    ]);
  });
});

class BlockingListEventStore implements AcpEventStore {
  private blockedListStarted: (() => void) | undefined;
  private releaseList: (() => void) | undefined;
  private readonly blockedListPromise = new Promise<void>(resolve => {
    this.blockedListStarted = resolve;
  });
  private readonly releaseListPromise = new Promise<void>(resolve => {
    this.releaseList = resolve;
  });

  constructor(private readonly inner: AcpEventStore) {}

  append(input: AcpAppendEventInput): Promise<AcpEventRecord> {
    return this.inner.append(input);
  }

  async list(input: Parameters<AcpEventStore['list']>[0]): Promise<AcpEventRecord[]> {
    this.blockedListStarted?.();
    await this.releaseListPromise;
    return this.inner.list(input);
  }

  waitForBlockedList(): Promise<void> {
    return this.blockedListPromise;
  }

  releaseBlockedList(): void {
    this.releaseList?.();
  }
}

class FakeFanoutRedisAdapter implements AcpFanoutRedisAdapter {
  readonly published: AcpFanoutRedisNotification[] = [];
  readonly closedSubscriptions: string[] = [];
  readonly subscribeInputs: Array<{
    sessionId: string;
    tenantId: string;
    ownerKeyId: string;
    subscriberId: string;
  }> = [];
  beforeSubscribeRegister: (() => Promise<void>) | undefined;
  failPublish = false;
  private readonly handlers = new Map<string, (notification: AcpFanoutRedisNotification) => void | Promise<void>>();

  async publish(notification: AcpFanoutRedisNotification): Promise<void> {
    if (this.failPublish) {
      throw new Error('redis unavailable');
    }
    this.published.push(notification);
  }

  async subscribe(
    input: { sessionId: string; tenantId: string; ownerKeyId: string; subscriberId: string },
    handler: (notification: AcpFanoutRedisNotification) => void | Promise<void>
  ): Promise<AcpFanoutRedisSubscription> {
    const key = `${input.sessionId}:${input.subscriberId}`;
    this.subscribeInputs.push(input);
    await this.beforeSubscribeRegister?.();
    this.handlers.set(key, handler);
    return {
      close: async (): Promise<void> => {
        this.handlers.delete(key);
        this.closedSubscriptions.push(key);
      },
    };
  }

  async emit(notification: AcpFanoutRedisNotification): Promise<void> {
    await Promise.all(
      [...this.handlers.values()].map(async handler => {
        await handler(notification);
      })
    );
  }
}
