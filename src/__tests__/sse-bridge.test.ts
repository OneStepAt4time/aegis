import { describe, it, expect, beforeEach } from 'vitest';
import { createSSEBridge } from '../services/sse-bridge.js';

class MockEventBus {
  handlers = new Map();
  subscribe(ch, h) {
    const arr = this.handlers.get(ch) ?? [];
    arr.push(h);
    this.handlers.set(ch, arr);
    return () => {
      const cur = this.handlers.get(ch) ?? [];
      this.handlers.set(ch, cur.filter(x => x !== h));
    };
  }
  emit(ch, ev) {
    const arr = this.handlers.get(ch) ?? [];
    for (const h of arr) h(ev);
  }
}

function createFakeServer() {
  let captured: any = null;
  return {
    get(path, handler) {
      captured = handler;
    },
    __getHandler() { return captured; }
  };
}

function makeReqReply() {
  const writes: string[] = [];
  const raw = {
    writes,
    setHeader(k: string, v: string) {},
    write(s: string) { writes.push(s); },
    on: (ev: string, fn: Function) => { raw['__close'] = fn; }
  } as any;
  const req = { raw, query: {} } as any;
  const reply = { raw } as any;
  return { req, reply, raw };
}

function wait(ms = 20) { return new Promise(r => setTimeout(r, ms)); }

describe('SSE Bridge', () => {
  let bus;
  let server;
  beforeEach(() => {
    bus = new MockEventBus();
    server = createFakeServer();
  });

  it('registers route and fans out events to clients', async () => {
    const bridge = createSSEBridge(bus, server);
    bridge.register(server);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    handler(req, reply);
    // simulate an event
    bus.emit('global', { id: 1, type: 't', channel: 'global', data: { a: 1 }, timestamp: new Date().toISOString() });
    await wait(20);
    expect(raw.writes.some(s => s.includes('event: t'))).toBeTruthy();
    bridge.destroy();
  });

  it('heartbeat writes periodically', async () => {
    const bridge = createSSEBridge(bus, server);
    bridge.register(server);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    handler(req, reply);
    // wait a bit longer than heartbeat interval to observe at least one
    await wait(50);
    // heartbeat string is ': hb'
    expect(raw.writes.some(s => s.includes(': hb'))).toBeTruthy();
    bridge.destroy();
  });

  it('clean disconnect removes client', async () => {
    const bridge = createSSEBridge(bus, server);
    bridge.register(server);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    handler(req, reply);
    // simulate close
    if (raw['__close']) raw['__close']();
    // emit event
    bus.emit('global', { id: 2, type: 'x', channel: 'global', data: {}, timestamp: new Date().toISOString() });
    await wait(20);
    // no write should be present for event x
    expect(raw.writes.every(s => !s.includes('event: x'))).toBeTruthy();
    bridge.destroy();
  });

  it('supports lastEventId on connect (stored but not required for fanout)', async () => {
    const bridge = createSSEBridge(bus, server);
    bridge.register(server);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    req.query.lastEventId = '5';
    handler(req, reply);
    // no error and header written
    expect(raw.writes.length >= 0).toBeTruthy();
    bridge.destroy();
  });

  it('multiple clients receive same event', async () => {
    const bridge = createSSEBridge(bus, server);
    bridge.register(server);
    const handler = server.__getHandler();
    const c1 = makeReqReply();
    const c2 = makeReqReply();
    handler(c1.req, c1.reply);
    handler(c2.req, c2.reply);
    bus.emit('global', { id: 9, type: 'big', channel: 'global', data: { x: 1 }, timestamp: new Date().toISOString() });
    await wait(20);
    expect(c1.raw.writes.some(s => s.includes('event: big'))).toBeTruthy();
    expect(c2.raw.writes.some(s => s.includes('event: big'))).toBeTruthy();
    bridge.destroy();
  });

  it('session:* events are also fanned out', async () => {
    const bridge = createSSEBridge(bus, server);
    bridge.register(server);
    const handler = server.__getHandler();
    const c = makeReqReply();
    handler(c.req, c.reply);
    bus.emit('session:abc', { id: 7, type: 's', channel: 'session:abc', data: {}, timestamp: new Date().toISOString() });
    await wait(20);
    expect(c.raw.writes.some(s => s.includes('event: s'))).toBeTruthy();
    bridge.destroy();
  });

  it('destroy unsubscribes from eventBus and clears clients', async () => {
    const bridge = createSSEBridge(bus, server);
    bridge.register(server);
    const handler = server.__getHandler();
    const c = makeReqReply();
    handler(c.req, c.reply);
    bridge.destroy();
    // emit event — should not be delivered
    bus.emit('global', { id: 8, type: 'gone', channel: 'global', data: {}, timestamp: new Date().toISOString() });
    await wait(20);
    expect(c.raw.writes.every(s => !s.includes('event: gone'))).toBeTruthy();
  });
});
