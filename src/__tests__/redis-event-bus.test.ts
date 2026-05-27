import { describe, it, expect, beforeEach } from 'vitest';
import { RedisEventBus, type RedisLike } from '../redis-event-bus.js';
import type { BusEvent, BusEventHandler } from '../event-bus.js';

// Minimal in-memory Redis mock used for tests
class MockRedis implements RedisLike {
  streams = new Map<string, Array<[string, string[]]>>();
  seq = new Map<string, number>();
  idCounter = 1;
  throwOnce = false;

  incr(key: string): number {
    const v = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, v);
    return v;
  }

  xadd(stream: string, _id: string, ...fields: string[]): string {
    const store = this.streams.get(stream) ?? [];
    const entryId = `${this.idCounter++}-0`;
    store.push([entryId, fields]);
    this.streams.set(stream, store);
    return entryId;
  }

  xrange(stream: string, start: string, _end: string): Array<[string, string[]]> {
    if (this.throwOnce) {
      this.throwOnce = false;
      throw new Error('transient');
    }
    const store = this.streams.get(stream) ?? [];
    if (start === '-') return store.map(([id, fields]: [string, string[]]) => [id, fields]);
    return store.filter(([id]: [string, string[]]) => id > start).map(([id, fields]: [string, string[]]) => [id, fields]);
  }

  async scan(_cursor: number, opts?: { MATCH?: string; COUNT?: number }): Promise<[number, string[]]> {
    const keys = Array.from(this.streams.keys());
    return [0, keys];
  }
}

function wait(ms = 50): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe('RedisEventBus (mocked)', () => {
  let redis: MockRedis;
  beforeEach(() => {
    redis = new MockRedis();
  });

  it('publish returns numeric id and subscriber receives events', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got: BusEvent[] = [];
    bus.subscribe('session:1', (e: BusEvent) => got.push(e));
    const id = bus.publish('session:1', 'created', { foo: 'bar' });
    expect(typeof id === 'number').toBeTruthy();
    await wait(60);
    expect(got.length).toBe(1);
    expect(got[0].type).toBe('created');
    bus.destroy();
  });

  it('replaySince returns events after given id', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const a = bus.publish('session:2', 'a', { n: 1 });
    const b = bus.publish('session:2', 'b', { n: 2 });
    await wait(20);
    const all = bus.replaySince('session:2', 0);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const afterA = bus.replaySince('session:2', a);
    expect(afterA.every((x: BusEvent) => x.id > a)).toBeTruthy();
    bus.destroy();
  });

  it('pattern subscription receives from multiple channels', async () => {
    redis.xadd('aegis:events:session:10', '0-0', 'seq', '1', 'type', 'x', 'timestamp', new Date().toISOString(), 'data', JSON.stringify({}));
    redis.xadd('aegis:events:session:11', '0-0', 'seq', '2', 'type', 'y', 'timestamp', new Date().toISOString(), 'data', JSON.stringify({}));
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got: BusEvent[] = [];
    bus.subscribe('session:*', (e: BusEvent) => got.push(e));
    bus.publish('session:10', 'z', { k: 1 });
    bus.publish('session:11', 'w', { k: 2 });
    await wait(80);
    expect(got.some((x: BusEvent) => x.channel === 'session:10')).toBeTruthy();
    expect(got.some((x: BusEvent) => x.channel === 'session:11')).toBeTruthy();
    bus.destroy();
  });

  it('destroy stops further deliveries', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got: BusEvent[] = [];
    bus.subscribe('global', (e: BusEvent) => got.push(e));
    bus.publish('global', 't', {});
    await wait(40);
    expect(got.length).toBeGreaterThan(0);
    bus.destroy();
    bus.publish('global', 't2', {});
    await wait(40);
    expect(got.find((e: BusEvent) => e.type === 't2')).toBeUndefined();
  });

  it('multiple handlers receive events and one throwing does not break others', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const gotA: BusEvent[] = [];
    const gotB: BusEvent[] = [];
    bus.subscribe('multi', (e: BusEvent) => { gotA.push(e); });
    bus.subscribe('multi', () => { throw new Error('boom'); });
    bus.subscribe('multi', (e: BusEvent) => { gotB.push(e); });
    bus.publish('multi', 'm', {});
    await wait(60);
    expect(gotA.length).toBe(1);
    expect(gotB.length).toBe(1);
    bus.destroy();
  });

  it('unsubscribe removes handler', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got: BusEvent[] = [];
    const unsub = bus.subscribe('one', (e: BusEvent) => got.push(e));
    bus.publish('one', 'x', {});
    await wait(40);
    expect(got.length).toBe(1);
    unsub();
    bus.publish('one', 'y', {});
    await wait(40);
    expect(got.length).toBe(1);
    bus.destroy();
  });

  it('pattern unsubscribe removes handlers from matching streams', async () => {
    redis.xadd('aegis:events:sesh:1', '0-0', 'seq', '1', 'type', 'p', 'timestamp', new Date().toISOString(), 'data', JSON.stringify({}));
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got: BusEvent[] = [];
    const unsub = bus.subscribe('sesh:*', (e: BusEvent) => got.push(e));
    bus.publish('sesh:1', 'a', {});
    await wait(40);
    expect(got.length).toBeGreaterThan(0);
    unsub();
    bus.publish('sesh:1', 'b', {});
    await wait(40);
    expect(got.find((e: BusEvent) => e.type === 'b')).toBeUndefined();
    bus.destroy();
  });

  it('replaySince on empty stream returns empty array', () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const out = bus.replaySince('does-not-exist', 0);
    expect(Array.isArray(out)).toBeTruthy();
    expect(out.length).toBe(0);
    bus.destroy();
  });

  it('publish id monotonic per-channel', () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const a = bus.publish('c1', 'a', {});
    const b = bus.publish('c1', 'b', {});
    expect(b >= a).toBeTruthy();
    bus.destroy();
  });

  it('transient xrange errors are tolerated and delivery resumes', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got: BusEvent[] = [];
    redis.throwOnce = true;
    bus.subscribe('resilient', (e: BusEvent) => got.push(e));
    bus.publish('resilient', 'ok', {});
    await wait(120);
    expect(got.length).toBeGreaterThanOrEqual(1);
    bus.destroy();
  });
});
