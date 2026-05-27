/**
 * redis-event-bus.ts — Redis Streams based EventBus implementation.
 *
 * Issue #4229 phases C-D.
 *
 * Key design decisions:
 * - publish() returns a numeric ID synchronously (local INCR fallback)
 *   but the actual XADD is async/fire-and-forget. Callers get a best-effort ID.
 * - replaySince() is async — must await Redis XRANGE.
 * - Pattern subscriptions rescan periodically to discover new streams.
 * - New subscriptions start from current time ("+") to avoid replaying history.
 */

import { StructuredLogger } from './logger.js';
import { type EventBus, type BusEvent, type BusEventHandler } from './event-bus.js';

const log = new StructuredLogger();

const DEFAULT_STREAM_PREFIX = 'aegis:events:';
const DEFAULT_POLL_MS = 200;
const RESCAN_INTERVAL_MS = 5_000;

export interface RedisLike {
  incr(key: string): Promise<number> | number;
  xadd(stream: string, id: string, ...fields: Array<string>): Promise<string> | string;
  xrange(stream: string, start: string, end: string, count?: number): Promise<Array<[string, string[]]>> | Array<[string, string[]]>;
  scan(cursor: number, opts?: { MATCH?: string; COUNT?: number }): Promise<[number, string[]]> | [number, string[]];
}

interface SubscriptionState {
  lastId: string;
  handlers: Set<BusEventHandler>;
  timer?: NodeJS.Timeout;
}

export class RedisEventBus implements EventBus {
  private client: RedisLike;
  private prefix: string;
  private pollMs: number;
  private running = new Map<string, SubscriptionState>();
  private rescanTimers: NodeJS.Timeout[] = [];
  private destroyed = false;

  constructor(client: RedisLike, opts?: { prefix?: string; pollMs?: number }) {
    this.client = client;
    this.prefix = opts?.prefix ?? DEFAULT_STREAM_PREFIX;
    this.pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  }

  private streamKey(channel: string): string {
    return `${this.prefix}${channel}`;
  }

  private entryToEvent(channel: string, entryId: string, fields: string[]): BusEvent {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = fields[i + 1];
    }
    const id = Number(obj['seq'] ?? NaN) || Date.now();
    return {
      channel,
      id,
      type: obj.type ?? 'unknown',
      timestamp: obj.timestamp ?? new Date().toISOString(),
      data: obj.data ? JSON.parse(obj.data) : {},
    };
  }

  publish(channel: string, type: string, data: Record<string, unknown>): number {
    const stream = this.streamKey(channel);
    const seqKey = `${stream}:seq`;

    // Synchronous ID allocation — use a local counter if incr is async
    const seqResult = this.client.incr(seqKey);
    const localId = Date.now(); // fallback

    // Fire-and-forget XADD — callers get a best-effort ID
    const doWrite = async () => {
      try {
        const numericSeq = seqResult instanceof Promise ? await seqResult : seqResult;
        const timestamp = new Date().toISOString();
        const fields = ['seq', String(numericSeq), 'type', type, 'timestamp', timestamp, 'data', JSON.stringify(data)];
        await this.client.xadd(stream, '*', ...fields);
        return numericSeq;
      } catch (err) {
        log.warn({ component: 'redis-event-bus', operation: 'xadd', attributes: { error: String(err), channel } });
        return localId;
      }
    };

    void doWrite();

    // Return sync ID: use incr result if sync, else timestamp fallback
    if (!(seqResult instanceof Promise)) {
      return seqResult as number;
    }
    return localId;
  }

  subscribe(channel: string, handler: BusEventHandler): () => void {
    if (channel.includes('*')) {
      return this.patternSubscribe(channel, handler);
    }

    const key = this.streamKey(channel);
    let state = this.running.get(key);
    if (!state) {
      // Start from "+" to only get NEW events (avoid replaying history)
      state = { lastId: '+', handlers: new Set() };
      this.running.set(key, state);
      void this.pollLoop(channel, key, state);
    }
    state.handlers.add(handler);

    return () => {
      state!.handlers.delete(handler);
      if (state!.handlers.size === 0) {
        const s = this.running.get(key);
        if (s?.timer) clearTimeout(s.timer);
        this.running.delete(key);
      }
    };
  }

  private patternSubscribe(channel: string, handler: BusEventHandler): () => void {
    const pattern = this.prefix + channel;

    // Initial scan + periodic rescan for new streams
    const scanAndRegister = async () => {
      if (this.destroyed) return;
      try {
        let cursor = 0;
        do {
          const res = await this.client.scan(cursor, { MATCH: pattern, COUNT: 100 });
          cursor = Number(res[0]);
          for (const k of res[1]) {
            const ch = k.replace(this.prefix, '');
            if (!this.running.has(k)) {
              const state: SubscriptionState = { lastId: '+', handlers: new Set([handler]) };
              this.running.set(k, state);
              void this.pollLoop(ch, k, state);
            } else {
              this.running.get(k)!.handlers.add(handler);
            }
          }
        } while (cursor !== 0);
      } catch (err) {
        log.warn({ component: 'redis-event-bus', operation: 'scan', attributes: { error: String(err) } });
      }
    };

    void scanAndRegister();

    // Periodic rescan to discover new streams
    const rescanTimer = setInterval(() => void scanAndRegister(), RESCAN_INTERVAL_MS);
    this.rescanTimers.push(rescanTimer);

    return () => {
      clearInterval(rescanTimer);
      for (const [, v] of this.running.entries()) {
        v.handlers.delete(handler);
        if (v.handlers.size === 0) {
          if (v.timer) clearTimeout(v.timer);
          this.running.delete(v as any);
        }
      }
    };
  }

  private async pollLoop(channel: string, key: string, state: SubscriptionState): Promise<void> {
    while (this.running.has(key) && !this.destroyed) {
      try {
        const fromId = state.lastId === '+' ? '+' : state.lastId;
        const entries = await this.client.xrange(key, fromId, '+');
        if (Array.isArray(entries) && entries.length > 0) {
          for (const [entryId, fields] of entries) {
            // Skip the starting entry if we started from our last seen
            if (entryId === state.lastId) continue;
            const ev = this.entryToEvent(channel, entryId, fields as string[]);
            state.lastId = entryId;
            for (const h of Array.from(state.handlers)) {
              try {
                setImmediate(() => { try { h(ev); } catch (_e) { /* swallow handler errors */ } });
              } catch (e) {
                log.warn({ component: 'redis-event-bus', operation: 'deliver', attributes: { error: String(e) } });
              }
            }
          }
        }
      } catch (err) {
        log.warn({ component: 'redis-event-bus', operation: 'poll', attributes: { error: String(err) } });
      }

      await new Promise<void>(r => {
        state.timer = setTimeout(() => r(), this.pollMs);
      });
    }
  }

  async replaySince(channel: string, lastEventId: number): Promise<BusEvent[]> {
    try {
      const key = this.streamKey(channel);
      const entries = await this.client.xrange(key, '-', '+');
      if (!Array.isArray(entries)) return [];
      const out: BusEvent[] = [];
      for (const [entryId, fields] of entries) {
        const ev = this.entryToEvent(channel, entryId, fields as string[]);
        if (ev.id > lastEventId) out.push(ev);
      }
      return out;
    } catch (err) {
      log.warn({ component: 'redis-event-bus', operation: 'replaySince', attributes: { error: String(err) } });
      return [];
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const [, v] of this.running.entries()) {
      if (v.timer) clearTimeout(v.timer);
      v.handlers.clear();
    }
    this.running.clear();
    for (const t of this.rescanTimers) clearInterval(t);
    this.rescanTimers = [];
  }
}
