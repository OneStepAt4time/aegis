/**
 * local-event-bus.ts — In-process EventBus implementation using EventEmitter.
 *
 * Issue #4229: Default EventBus implementation. Zero external deps.
 * Uses per-channel EventEmitters with ring buffers for replay.
 */

import { EventEmitter } from 'node:events';
import { StructuredLogger } from './logger.js';
import { type EventBus, type BusEvent, type BusEventHandler } from './event-bus.js';

const log = new StructuredLogger();

/** Maximum events buffered per channel for replay. */
const DEFAULT_BUFFER_SIZE = 50;

export class LocalEventBus implements EventBus {
  private emitters = new Map<string, EventEmitter>();
  private buffers = new Map<string, Array<BusEvent>>();
  private nextId = 1;
  private readonly bufferSize: number;

  constructor(bufferSize = DEFAULT_BUFFER_SIZE) {
    this.bufferSize = bufferSize;
  }

  private allocateId(): number {
    if (this.nextId >= Number.MAX_SAFE_INTEGER) {
      log.warn({ component: 'event-bus', operation: 'idCounterReset' });
      this.nextId = 1;
    }
    return this.nextId++;
  }

  private getEmitter(channel: string): EventEmitter {
    let emitter = this.emitters.get(channel);
    if (!emitter) {
      emitter = new EventEmitter();
      emitter.setMaxListeners(50);
      this.emitters.set(channel, emitter);
    }
    return emitter;
  }

  publish(channel: string, type: string, data: Record<string, unknown>): number {
    const id = this.allocateId();
    const event: BusEvent = {
      channel,
      id,
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // Buffer for replay
    let buffer = this.buffers.get(channel);
    if (!buffer) {
      buffer = [];
      this.buffers.set(channel, buffer);
    }
    buffer.push(event);
    if (buffer.length > this.bufferSize) {
      buffer.splice(0, buffer.length - this.bufferSize);
    }

    // Emit asynchronously (consistent with existing SessionEventBus behavior)
    const emitter = this.emitters.get(channel);
    if (emitter) {
      const imm = setImmediate(() => {
        emitter!.emit('event', event);
      });
      // Track for cleanup? Not at interface level — emitter cleanup handles it.
      void imm; // suppress unused warning
    }

    return id;
  }

  subscribe(channel: string, handler: BusEventHandler): () => void {
    const emitter = this.getEmitter(channel);
    const wrapped = (event: BusEvent) => handler(event);
    emitter.on('event', wrapped);
    return () => {
      emitter.off('event', wrapped);
      if (emitter.listenerCount('event') === 0) {
        this.emitters.delete(channel);
      }
    };
  }

  replaySince(channel: string, lastEventId: number): BusEvent[] {
    const buffer = this.buffers.get(channel);
    if (!buffer) return [];
    return buffer.filter(e => e.id > lastEventId);
  }

  destroy(): void {
    for (const emitter of this.emitters.values()) {
      emitter.removeAllListeners();
    }
    this.emitters.clear();
    this.buffers.clear();
  }
}
