import { describe, it, expect, beforeEach, vi } from 'vitest';
import RedisEventBus from '../redis-event-bus.js';

// Minimal in-memory Redis mock used for tests
class MockRedis {
  streams = new Map();
  seq = new Map();
  idCounter = 1;
  throwOnce = false;

  incr(key) {
    const v = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, v);
    return v;
  }

  xadd(stream, id, ...fields) {
    const store = this.streams.get(stream) ?? [];
    const entryId = `${this.idCounter++}-0`;
    store.push([entryId, fields]);
    this.streams.set(stream, store);
    return entryId;
  }

  xrange(stream, start, end) {
    if (this.throwOnce) {
      this.throwOnce = false;
      throw new Error('transient');
    }
    const store = this.streams.get(stream) ?? [];
    if (start === '-' ) return store.map(([id, fields]) => [id, fields]);
    // return entries with id > start
    return store.filter(([id]) => id > start).map(([id, fields]) => [id, fields]);
  }

  async scan(cursor, opts) {
    // return all keys at once
    const keys = Array.from(this.streams.keys());
    return [0, keys];
  }
}

function wait(ms = 50) {
  return new Promise(r => setTimeout(r, ms));
}

describe('RedisEventBus (mocked)', () => {
  let redis;
  beforeEach(() => {
    redis = new MockRedis();
  });

  it('publish returns numeric id and subscriber receives events', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got = [];
    bus.subscribe('session:1', (e) => got.push(e));
    const id = bus.publish('session:1', 'created', { foo: 'bar' });
    expect(typeof id === 'number' || typeof id === 'bigint' || typeof id === 'string').toBeTruthy();
    await wait(60);
    expect(got.length).toBe(1);
    expect(got[0].type).toBe('created');
    bus.destroy();
  });

  it('replaySince returns events after given id', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const a = bus.publish('session:2', 'a', { n: 1 });
    const b = bus.publish('session:2', 'b', { n: 2 });
    // allow writes
    await wait(20);
    const all = bus.replaySince('session:2', 0);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const afterA = bus.replaySince('session:2', a);
    expect(afterA.every(x => x.id > a)).toBeTruthy();
    bus.destroy();
  });

  it('pattern subscription receives from multiple channels', async () => {
    // pre-create streams so scan finds them
    redis.xadd('aegis:events:session:10', '0-0', 'seq', '1', 'type', 'x', 'timestamp', new Date().toISOString(), 'data', JSON.stringify({}));
    redis.xadd('aegis:events:session:11', '0-0', 'seq', '2', 'type', 'y', 'timestamp', new Date().toISOString(), 'data', JSON.stringify({}));
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got = [];
    bus.subscribe('session:*', (e) => got.push(e));
    // publish new events on both
    bus.publish('session:10', 'z', { k: 1 });
    bus.publish('session:11', 'w', { k: 2 });
    await wait(80);
    // should have received at least two
    expect(got.some(x => x.channel === 'session:10')).toBeTruthy();
    expect(got.some(x => x.channel === 'session:11')).toBeTruthy();
    bus.destroy();
  });

  it('destroy stops further deliveries', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got = [];
    bus.subscribe('global', (e) => got.push(e));
    bus.publish('global', 't', {});
    await wait(40);
    expect(got.length).toBeGreaterThan(0);
    bus.destroy();
    bus.publish('global', 't2', {});
    await wait(40);
    // no new events after destroy
    expect(got.find(e => e.type === 't2')).toBeUndefined();
  });

  it('multiple handlers receive events and one throwing does not break others', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const gotA = [];
    const gotB = [];
    bus.subscribe('multi', (e) => { gotA.push(e); });
    bus.subscribe('multi', (e) => { throw new Error('boom'); });
    bus.subscribe('multi', (e) => { gotB.push(e); });
    bus.publish('multi', 'm', {});
    await wait(60);
    expect(gotA.length).toBe(1);
    expect(gotB.length).toBe(1);
    bus.destroy();
  });

  it('unsubscribe removes handler', async () => {
    const bus = new RedisEventBus(redis, { pollMs: 20 });
    const got = [];
    const unsub = bus.subscribe('one', (e) => got.push(e));
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
    const got = [];
    const unsub = bus.subscribe('sesh:*', (e) => got.push(e));
    bus.publish('sesh:1', 'a', {});
    await wait(40);
    expect(got.length).toBeGreaterThan(0);
    unsub();
    bus.publish('sesh:1', 'b', {});
    await wait(40);
    // should not receive second
    expect(got.find(e => e.type === 'b')).toBeUndefined();
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
    const got = [];
    // make next xrange throw
    redis.throwOnce = true;
    bus.subscribe('resilient', (e) => got.push(e));
    bus.publish('resilient', 'ok', {});
    await wait(120);
    expect(got.length).toBeGreaterThanOrEqual(1);
    bus.destroy();
  });
});
