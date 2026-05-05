import type {
  AcpAppendEventInput,
  AcpEventRecord,
  AcpEventStore,
} from './event-store.js';
import type { AcpSessionScope } from './types.js';

const DEFAULT_REPLAY_LIMIT = 1_000;

export type AcpFanoutDeliverySource = 'replay' | 'live' | 'redis';

export interface AcpFanoutDelivery {
  source: AcpFanoutDeliverySource;
  event: AcpEventRecord;
}

export type AcpFanoutHandler = (delivery: AcpFanoutDelivery) => void | Promise<void>;

export interface AcpFanoutSubscribeInput extends AcpSessionScope {
  sessionId: string;
  subscriberId: string;
  /**
   * Durable cursor handoff. When present, the fanout first replays events with
   * eventSeq greater than this value, then starts live delivery without gaps.
   */
  afterEventSeq?: number;
  replayLimit?: number;
}

export interface AcpFanoutStreamScope extends AcpSessionScope {
  sessionId: string;
}

export interface AcpFanoutSubscription {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly ownerKeyId: string;
  readonly subscriberId: string;
  close(): Promise<void>;
}

export interface AcpFanout {
  publish(input: AcpAppendEventInput): Promise<AcpEventRecord>;
  subscribe(
    input: AcpFanoutSubscribeInput,
    handler: AcpFanoutHandler
  ): Promise<AcpFanoutSubscription>;
}

export interface AcpFanoutRedisNotification {
  sessionId: string;
  tenantId: string;
  ownerKeyId: string;
  eventId: string;
  eventSeq: number;
  eventType: string;
  backendRunId?: string;
}

export interface AcpFanoutRedisSubscription {
  close(): Promise<void>;
}

/**
 * Minimal Redis pub/sub boundary used by AcpFanout.
 *
 * ACP-028 exposes Redis coordination primitives, but concrete Redis clients
 * differ in how message handlers are wired. This boundary keeps fanout delivery
 * unit-testable without a real Redis server while preserving Redis as a volatile
 * wakeup channel; durable event records are still read from AcpEventStore.
 */
export interface AcpFanoutRedisAdapter {
  publish(notification: AcpFanoutRedisNotification): Promise<void>;
  subscribe(
    input: Pick<AcpFanoutSubscribeInput, 'sessionId' | 'tenantId' | 'ownerKeyId' | 'subscriberId'>,
    handler: (notification: AcpFanoutRedisNotification) => void | Promise<void>
  ): Promise<AcpFanoutRedisSubscription>;
}

export interface AcpFanoutVolatilityContract {
  readonly redisIsSourceOfTruth: false;
  readonly durableRecoverySources: readonly ['postgres-event-replay'];
  readonly summary: string;
}

export const ACP_FANOUT_VOLATILITY_CONTRACT: AcpFanoutVolatilityContract = {
  redisIsSourceOfTruth: false,
  durableRecoverySources: ['postgres-event-replay'],
  summary:
    'ACP fanout uses Redis only as a volatile live-delivery hint. Subscribers recover missed delivery from durable event replay.',
};

export interface LocalAcpFanoutOptions {
  eventStore: AcpEventStore;
}

interface PendingDelivery {
  source: AcpFanoutDeliverySource;
  event: AcpEventRecord;
}

interface LocalSubscriber {
  readonly streamKey: string;
  readonly subscriberKey: string;
  readonly input: AcpFanoutSubscribeInput;
  readonly handler: AcpFanoutHandler;
  pending: PendingDelivery[];
  lastDeliveredSeq: number;
  replaying: boolean;
  closed: boolean;
  deliveryChain: Promise<void>;
}

export class LocalAcpFanout implements AcpFanout {
  private readonly eventStore: AcpEventStore;
  private readonly subscribers = new Map<string, Map<string, LocalSubscriber>>();
  private deliveryChain: Promise<void> = Promise.resolve();

  constructor(options: LocalAcpFanoutOptions) {
    this.eventStore = options.eventStore;
  }

  async publish(input: AcpAppendEventInput): Promise<AcpEventRecord> {
    const event = await this.eventStore.append(input);
    await this.deliverStoredEvent(event, 'live');
    return event;
  }

  async subscribe(
    input: AcpFanoutSubscribeInput,
    handler: AcpFanoutHandler
  ): Promise<AcpFanoutSubscription> {
    const normalized = normalizeSubscribeInput(input);
    const streamKey = streamKeyFor(normalized);
    const subscriberKey = normalized.subscriberId;
    const subscribers = this.getStreamSubscribers(streamKey);
    const subscriber: LocalSubscriber = {
      streamKey,
      subscriberKey,
      input: normalized,
      handler,
      pending: [],
      lastDeliveredSeq: normalized.afterEventSeq ?? 0,
      replaying: normalized.afterEventSeq !== undefined,
      closed: false,
      deliveryChain: Promise.resolve(),
    };

    const existing = subscribers.get(subscriberKey);
    if (existing !== undefined) {
      existing.closed = true;
      existing.pending = [];
    }
    subscribers.set(subscriberKey, subscriber);

    try {
      await this.enqueueSubscriber(subscriber, async () => {
        if (normalized.afterEventSeq !== undefined) {
          await this.replayToSubscriber(subscriber, normalized);
        }
        await this.flushPending(subscriber);
        subscriber.replaying = false;
      });
    } catch (error) {
      await this.closeSubscriber(subscriber);
      throw error;
    }

    return {
      sessionId: normalized.sessionId,
      tenantId: normalized.tenantId,
      ownerKeyId: normalized.ownerKeyId,
      subscriberId: normalized.subscriberId,
      close: async (): Promise<void> => {
        await this.closeSubscriber(subscriber);
      },
    };
  }

  async deliverStoredEvent(
    event: AcpEventRecord,
    source: AcpFanoutDeliverySource = 'live'
  ): Promise<void> {
    const run = this.deliveryChain.then(() => this.deliverStoredEventNow(event, source));
    this.deliveryChain = run.catch(() => {});
    await run;
  }

  async catchUpSubscriber(
    input: AcpFanoutSubscribeInput,
    source: AcpFanoutDeliverySource,
    throughEventSeq?: number
  ): Promise<void> {
    const normalized = normalizeSubscribeInput(input);
    const subscriber = this.subscribers
      .get(streamKeyFor(normalized))
      ?.get(normalized.subscriberId);
    if (subscriber === undefined || subscriber.closed) return;
    await this.enqueueSubscriber(subscriber, async () => {
      await this.catchUpSubscriberFromStore(subscriber, normalized, source, throughEventSeq);
      await this.flushPending(subscriber);
    });
  }

  subscriberCount(scope: AcpFanoutStreamScope): number {
    return this.subscribers.get(streamKeyFor(scope))?.size ?? 0;
  }

  private async replayToSubscriber(
    subscriber: LocalSubscriber,
    input: AcpFanoutSubscribeInput
  ): Promise<void> {
    await this.catchUpSubscriberFromStore(subscriber, input, 'replay');
  }

  private async catchUpSubscriberFromStore(
    subscriber: LocalSubscriber,
    input: AcpFanoutSubscribeInput,
    source: AcpFanoutDeliverySource,
    throughEventSeq?: number
  ): Promise<void> {
    const limit = input.replayLimit ?? DEFAULT_REPLAY_LIMIT;
    while (!subscriber.closed) {
      const replay = await this.eventStore.list({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        ownerKeyId: input.ownerKeyId,
        afterEventSeq: subscriber.lastDeliveredSeq,
        limit,
      });
      if (replay.length === 0) return;

      let deliveredFromPage = false;
      for (const event of replay) {
        if (throughEventSeq !== undefined && event.eventSeq > throughEventSeq) {
          return;
        }
        if (subscriber.pending.some(delivery => delivery.event.eventSeq === event.eventSeq)) {
          continue;
        }
        await this.deliverToSubscriber(subscriber, event, source);
        deliveredFromPage = true;
      }

      if (throughEventSeq !== undefined && subscriber.lastDeliveredSeq >= throughEventSeq) {
        return;
      }
      if (replay.length < limit || !deliveredFromPage) {
        return;
      }
    }
  }

  private async flushPending(subscriber: LocalSubscriber): Promise<void> {
    while (!subscriber.closed && subscriber.pending.length > 0) {
      const pending = [...subscriber.pending].sort((left, right) => left.event.eventSeq - right.event.eventSeq);
      subscriber.pending = [];
      for (const delivery of pending) {
        await this.deliverBufferedToSubscriber(subscriber, delivery.event, delivery.source);
      }
    }
  }

  private async deliverStoredEventNow(
    event: AcpEventRecord,
    source: AcpFanoutDeliverySource
  ): Promise<void> {
    const subscribers = this.subscribers.get(streamKeyFor(event));
    if (subscribers === undefined) return;

    const orderedSubscribers = [...subscribers.values()];
    await Promise.all(
      orderedSubscribers.map(subscriber =>
        this.enqueueSubscriber(subscriber, async () => {
          await this.deliverToSubscriber(subscriber, event, source);
        })
      )
    );
  }

  private async deliverToSubscriber(
    subscriber: LocalSubscriber,
    event: AcpEventRecord,
    source: AcpFanoutDeliverySource
  ): Promise<void> {
    if (subscriber.closed || event.eventSeq <= subscriber.lastDeliveredSeq) return;
    if (subscriber.replaying && source !== 'replay') {
      subscriber.pending.push({ event, source });
      return;
    }

    subscriber.lastDeliveredSeq = event.eventSeq;
    await this.invokeSubscriberHandler(subscriber, source, event);
  }

  private async deliverBufferedToSubscriber(
    subscriber: LocalSubscriber,
    event: AcpEventRecord,
    source: AcpFanoutDeliverySource
  ): Promise<void> {
    if (subscriber.closed || event.eventSeq <= subscriber.lastDeliveredSeq) return;
    subscriber.lastDeliveredSeq = event.eventSeq;
    await this.invokeSubscriberHandler(subscriber, source, event);
  }

  private enqueueSubscriber(
    subscriber: LocalSubscriber,
    operation: () => Promise<void>
  ): Promise<void> {
    const run = subscriber.deliveryChain.then(operation);
    subscriber.deliveryChain = run.catch(() => {});
    return run;
  }

  private async invokeSubscriberHandler(
    subscriber: LocalSubscriber,
    source: AcpFanoutDeliverySource,
    event: AcpEventRecord
  ): Promise<void> {
    try {
      await subscriber.handler({ source, event: cloneEvent(event) });
    } catch {
      await this.closeSubscriber(subscriber);
    }
  }

  private getStreamSubscribers(streamKey: string): Map<string, LocalSubscriber> {
    let subscribers = this.subscribers.get(streamKey);
    if (subscribers === undefined) {
      subscribers = new Map<string, LocalSubscriber>();
      this.subscribers.set(streamKey, subscribers);
    }
    return subscribers;
  }

  private async closeSubscriber(subscriber: LocalSubscriber): Promise<void> {
    if (subscriber.closed) return;
    subscriber.closed = true;
    subscriber.pending = [];
    const subscribers = this.subscribers.get(subscriber.streamKey);
    if (subscribers?.get(subscriber.subscriberKey) === subscriber) {
      subscribers.delete(subscriber.subscriberKey);
    }
    if (subscribers?.size === 0) {
      this.subscribers.delete(subscriber.streamKey);
    }
  }
}

export interface RedisAcpFanoutOptions {
  eventStore: AcpEventStore;
  redis: AcpFanoutRedisAdapter;
}

export class RedisAcpFanout implements AcpFanout {
  private readonly local: LocalAcpFanout;
  private readonly redis: AcpFanoutRedisAdapter;

  constructor(options: RedisAcpFanoutOptions) {
    this.local = new LocalAcpFanout({ eventStore: options.eventStore });
    this.redis = options.redis;
  }

  async publish(input: AcpAppendEventInput): Promise<AcpEventRecord> {
    const event = await this.local.publish(input);
    await this.redis.publish(toRedisNotification(event)).catch(() => {});
    return event;
  }

  async subscribe(
    input: AcpFanoutSubscribeInput,
    handler: AcpFanoutHandler
  ): Promise<AcpFanoutSubscription> {
    let redisSubscription: AcpFanoutRedisSubscription | undefined;

    try {
      redisSubscription = await this.redis.subscribe(
        {
          sessionId: input.sessionId,
          tenantId: input.tenantId,
          ownerKeyId: input.ownerKeyId,
          subscriberId: input.subscriberId,
        },
        async notification => {
          if (notification.sessionId !== input.sessionId) return;
          if (notification.tenantId !== input.tenantId) return;
          if (notification.ownerKeyId !== input.ownerKeyId) return;
          await this.replayNotification(input, notification);
        }
      );
    } catch (error) {
      throw error;
    }

    let localSubscription: AcpFanoutSubscription;
    try {
      localSubscription = await this.local.subscribe(input, handler);
    } catch (error) {
      await redisSubscription.close();
      throw error;
    }

    return {
      sessionId: localSubscription.sessionId,
      tenantId: localSubscription.tenantId,
      ownerKeyId: localSubscription.ownerKeyId,
      subscriberId: localSubscription.subscriberId,
      close: async (): Promise<void> => {
        await localSubscription.close();
        await redisSubscription?.close();
      },
    };
  }

  subscriberCount(scope: AcpFanoutStreamScope): number {
    return this.local.subscriberCount(scope);
  }

  private async replayNotification(
    input: AcpFanoutSubscribeInput,
    notification: AcpFanoutRedisNotification
  ): Promise<void> {
    await this.local.catchUpSubscriber(input, 'redis', notification.eventSeq);
  }
}

function toRedisNotification(event: AcpEventRecord): AcpFanoutRedisNotification {
  return {
    sessionId: event.sessionId,
    tenantId: event.tenantId,
    ownerKeyId: event.ownerKeyId,
    eventId: event.eventId,
    eventSeq: event.eventSeq,
    eventType: event.eventType,
  };
}

function normalizeSubscribeInput(input: AcpFanoutSubscribeInput): AcpFanoutSubscribeInput {
  const normalized: AcpFanoutSubscribeInput = {
    sessionId: requireNonEmptyString(input.sessionId, 'sessionId'),
    tenantId: requireNonEmptyString(input.tenantId, 'tenantId'),
    ownerKeyId: requireNonEmptyString(input.ownerKeyId, 'ownerKeyId'),
    subscriberId: requireNonEmptyString(input.subscriberId, 'subscriberId'),
  };

  if (input.afterEventSeq !== undefined) {
    normalized.afterEventSeq = requireNonNegativeSafeInteger(input.afterEventSeq, 'afterEventSeq');
  }
  normalized.replayLimit =
    input.replayLimit === undefined
      ? DEFAULT_REPLAY_LIMIT
      : requirePositiveSafeInteger(input.replayLimit, 'replayLimit');
  return normalized;
}

function streamKeyFor(scope: AcpFanoutStreamScope): string {
  return `${scope.tenantId}\u0000${scope.ownerKeyId}\u0000${scope.sessionId}`;
}

function requireNonEmptyString(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`ACP fanout ${field} must be a non-empty string`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ACP fanout ${field} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`ACP fanout ${field} must be a positive safe integer`);
  }
  return value;
}

function cloneEvent(event: AcpEventRecord): AcpEventRecord {
  return {
    ...event,
    occurredAt: new Date(event.occurredAt.getTime()),
    ingestedAt: new Date(event.ingestedAt.getTime()),
    payload: cloneJsonValue(event.payload),
  };
}

function cloneJsonValue<T>(value: T): T {
  return structuredClone(value);
}
