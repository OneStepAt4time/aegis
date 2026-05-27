/**
 * event-bus.ts — EventBus port interface for pub/sub event distribution.
 *
 * Issue #4229: Abstraction layer for session event fanout.
 * The existing SessionEventBus adapts to this interface.
 * Future implementations: Redis Streams, Postgres LISTEN/NOTIFY.
 *
 * Design principles:
 * - Interface is minimal: publish, subscribe, replay, destroy
 * - Typed channels — each channel maps to a domain (session events, global events)
 * - No delivery guarantees in the interface — implementations decide
 * - replaySince is async to support remote backends (Redis, Postgres)
 */

/** A typed event envelope on the bus. */
export interface BusEvent<T = Record<string, unknown>> {
  /** Channel this event was published on (e.g. 'session:abc123', 'global'). */
  channel: string;
  /** Monotonically increasing ID for replay/cursor support. */
  id: number;
  /** Event type within the channel. */
  type: string;
  /** Wall-clock timestamp (ISO 8601). */
  timestamp: string;
  /** Event payload. */
  data: T;
}

/** Handler invoked for each event matching a subscription. */
export type BusEventHandler<T = Record<string, unknown>> = (event: BusEvent<T>) => void;

/**
 * EventBus — generic pub/sub interface for Aegis event distribution.
 *
 * Implementations:
 * - `LocalEventBus`: in-process EventEmitter (default, zero deps)
 * - `RedisEventBus`: Redis Streams (optional, for multi-node)
 */
export interface EventBus {
  /**
   * Publish an event to a channel.
   * Returns the assigned event ID.
   * For async backends, the event may not be persisted yet when this returns.
   */
  publish(channel: string, type: string, data: Record<string, unknown>): number;

  /**
   * Subscribe to events on a channel.
   * Supports glob patterns: 'session:*' subscribes to all sessions.
   * Returns an unsubscribe function.
   */
  subscribe(channel: string, handler: BusEventHandler): () => void;

  /**
   * Replay events from a channel since the given event ID.
   * Returns events with id > lastEventId, up to the implementation's buffer limit.
   * Async to support remote backends (Redis, Postgres).
   */
  replaySince(channel: string, lastEventId: number): Promise<BusEvent[]>;

  /**
   * Clean up all subscriptions and resources.
   */
  destroy(): void;
}
