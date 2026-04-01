/**
 * channels/manager.ts — Routes events to all registered channels.
 *
 * The bridge calls ChannelManager methods. The manager fans out
 * to every registered channel, swallowing per-channel errors so
 * one broken channel never kills the bridge.
 */

import type {
  Channel,
  SessionEvent,
  SessionEventPayload,
  InboundCommand,
  InboundHandler,
} from './types.js';

/**
 * Thrown for retriable failures (5xx server errors, network timeouts).
 * Only these increment the circuit breaker failure count.
 * 4xx client errors are thrown as plain Error and do NOT trip the breaker.
 */
export class RetriableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetriableError';
  }
}

interface ChannelHealth {
  failCount: number;
  disabledUntil: number;
}

export class ChannelManager {
  private channels: Channel[] = [];
  private inboundHandler: InboundHandler | null = null;
  private health = new Map<string, ChannelHealth>();

  /** Consecutive failures before disabling a channel. */
  static readonly FAILURE_THRESHOLD = 5;

  /** Cooldown period in ms when a channel is disabled (5 min). */
  static readonly COOLDOWN_MS = 5 * 60 * 1000;

  /** Register a channel. Must be called before init(). */
  register(channel: Channel): void {
    this.channels.push(channel);
  }

  /** Initialize all channels. Pass the inbound handler for bidirectional channels. */
  async init(onInbound: InboundHandler): Promise<void> {
    this.inboundHandler = onInbound;
    for (const ch of this.channels) {
      try {
        await ch.init?.(onInbound);
        console.log(`Channel initialized: ${ch.name}`);
      } catch (e) {
        console.error(`Channel ${ch.name} failed to init:`, e);
      }
    }
  }

  /** Shut down all channels. */
  async destroy(): Promise<void> {
    for (const ch of this.channels) {
      try {
        await ch.destroy?.();
      } catch (e) {
        console.error(`Channel ${ch.name} failed to destroy:`, e);
      }
    }
  }

  /** Fan out a session-created event. */
  async sessionCreated(payload: SessionEventPayload): Promise<void> {
    await this.fanOut(payload, ch => ch.onSessionCreated?.(payload));
  }

  /** Fan out a session-ended event. */
  async sessionEnded(payload: SessionEventPayload): Promise<void> {
    await this.fanOut(payload, ch => ch.onSessionEnded?.(payload));
  }

  /** Fan out a message event. */
  async message(payload: SessionEventPayload): Promise<void> {
    await this.fanOut(payload, ch => ch.onMessage?.(payload));
  }

  /** Fan out a status change event. */
  async statusChange(payload: SessionEventPayload): Promise<void> {
    await this.fanOut(payload, ch => ch.onStatusChange?.(payload));
  }

  /** Fan out a swarm teammate event. */
  async swarmEvent(payload: SessionEventPayload): Promise<void> {
    await this.fanOut(payload, ch => ch.onStatusChange?.(payload));
  }

  /** How many channels are registered. */
  get count(): number {
    return this.channels.length;
  }

  /** Get all registered channels (for wiring optional dependencies). */
  getChannels(): readonly Channel[] {
    return this.channels;
  }

  /** Fan out to channels, respecting filters, swallowing errors. */
  private async fanOut(
    payload: SessionEventPayload,
    call: (ch: Channel) => Promise<void> | undefined,
  ): Promise<void> {
    const promises = this.channels.map(async ch => {
      // Circuit breaker: skip disabled channels during cooldown
      const health = this.health.get(ch.name);
      if (health && Date.now() < health.disabledUntil) return;

      try {
        // Check filter
        if (ch.filter && !ch.filter(payload.event)) return;
        await call(ch);
        // Success — reset failure count (channel may have been in cooldown)
        this.health.set(ch.name, { failCount: 0, disabledUntil: 0 });
      } catch (e) {
        console.error(`Channel ${ch.name} error on ${payload.event}:`, e);
        // Only count retriable errors (5xx, network) toward circuit breaker.
        // 4xx client errors are non-retriable — the server is healthy.
        if (!(e instanceof RetriableError)) return;
        const h = this.health.get(ch.name) ?? { failCount: 0, disabledUntil: 0 };
        h.failCount++;
        if (h.failCount >= ChannelManager.FAILURE_THRESHOLD) {
          h.disabledUntil = Date.now() + ChannelManager.COOLDOWN_MS;
          console.warn(
            `Channel ${ch.name} disabled after ${h.failCount} consecutive failures, cooldown until ${new Date(h.disabledUntil).toISOString()}`,
          );
        }
        this.health.set(ch.name, h);
      }
    });
    await Promise.allSettled(promises);
  }
}
