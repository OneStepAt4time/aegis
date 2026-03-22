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

export class ChannelManager {
  private channels: Channel[] = [];
  private inboundHandler: InboundHandler | null = null;

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

  /** How many channels are registered. */
  get count(): number {
    return this.channels.length;
  }

  /** Fan out to channels, respecting filters, swallowing errors. */
  private async fanOut(
    payload: SessionEventPayload,
    call: (ch: Channel) => Promise<void> | undefined,
  ): Promise<void> {
    const promises = this.channels.map(async ch => {
      try {
        // Check filter
        if (ch.filter && !ch.filter(payload.event)) return;
        await call(ch);
      } catch (e) {
        console.error(`Channel ${ch.name} error on ${payload.event}:`, e);
      }
    });
    await Promise.allSettled(promises);
  }
}
