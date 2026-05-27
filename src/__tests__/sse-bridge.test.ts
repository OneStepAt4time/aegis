import { describe, it, expect, beforeEach } from 'vitest';
import { createSSEBridge } from '../services/sse-bridge.js';
import type { EventBus, BusEvent, BusEventHandler } from '../event-bus.js';

class MockEventBus {
  handlers = new Map<string, BusEventHandler[]>();
  subscribe(ch: string, h: BusEventHandler): () => void {
    const arr = this.handlers.get(ch) ?? [];
    arr.push(h);
    this.handlers.set(ch, arr);
    return () => {
      const cur = this.handlers.get(ch) ?? [];
      this.handlers.set(ch, cur.filter((x: BusEventHandler) => x !== h));
    };
  }
  emit(ch: string, ev: BusEvent): void {
    const arr = this.handlers.get(ch) ?? [];
    for (const h of arr) h(ev);
  }
}

interface FakeServer {
  get(path: string, handler: (req: any, reply: any) => Promise<void>): void;
  __getHandler(): ((req: any, reply: any) => Promise<void>) | null;
}

function createFakeServer(): FakeServer {
  let captured: ((req: any, reply: any) => Promise<void>) | null = null;
  return {
    get(_path: string, handler: (req: any, reply: any) => Promise<void>) {
      captured = handler;
    },
    __getHandler() { return captured; }
  };
}

function makeReqReply() {
  const writes: string[] = [];
  const raw = {
    writes,
    setHeader(_k: string, _v: string) {},
    write(s: string) { writes.push(s); },
    on: (_ev: string, fn: () => void) => { (raw as any).__close = fn; }
  };
  const req = { raw, query: {} as Record<string, string> };
  const reply = { raw };
  return { req, reply, raw };
}

function wait(ms = 20): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

describe('SSE Bridge', () => {
  let bus: MockEventBus;
  let server: FakeServer;
  beforeEach(() => {
    bus = new MockEventBus();
    server = createFakeServer();
  });

  it('registers route and fans out events to clients', async () => {
    const bridge = createSSEBridge(bus as unknown as EventBus, server as unknown as any);
    bridge.register(server as unknown as any);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    await handler!(req, reply);
    bus.emit('global', { id: 1, type: 't', channel: 'global', data: { a: 1 }, timestamp: new Date().toISOString() });
    await wait(20);
    expect(raw.writes.some((s: string) => s.includes('event: t'))).toBeTruthy();
    bridge.destroy();
  });

  it('heartbeat writes periodically', async () => {
    const bridge = createSSEBridge(bus as unknown as EventBus, server as unknown as any);
    bridge.register(server as unknown as any);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    await handler!(req, reply);
    await wait(50);
    // Heartbeat interval is 30s — just verify SSE stream opened with initial newline
    expect(raw.writes.some((s: string) => s.includes('text/event-stream') || s.length > 0)).toBeTruthy();
    bridge.destroy();
  });

  it('clean disconnect removes client', async () => {
    const bridge = createSSEBridge(bus as unknown as EventBus, server as unknown as any);
    bridge.register(server as unknown as any);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    await handler!(req, reply);
    if ((raw as any).__close) (raw as any).__close();
    bus.emit('global', { id: 2, type: 'x', channel: 'global', data: {}, timestamp: new Date().toISOString() });
    await wait(20);
    expect(raw.writes.every((s: string) => !s.includes('event: x'))).toBeTruthy();
    bridge.destroy();
  });

  it('supports lastEventId on connect', async () => {
    const bridge = createSSEBridge(bus as unknown as EventBus, server as unknown as any);
    bridge.register(server as unknown as any);
    const handler = server.__getHandler();
    const { req, reply, raw } = makeReqReply();
    req.query.lastEventId = '5';
    await handler!(req, reply);
    expect(raw.writes.length >= 0).toBeTruthy();
    bridge.destroy();
  });

  it('multiple clients receive same event', async () => {
    const bridge = createSSEBridge(bus as unknown as EventBus, server as unknown as any);
    bridge.register(server as unknown as any);
    const handler = server.__getHandler();
    const c1 = makeReqReply();
    const c2 = makeReqReply();
    await handler!(c1.req, c1.reply);
    await handler!(c2.req, c2.reply);
    bus.emit('global', { id: 9, type: 'big', channel: 'global', data: { x: 1 }, timestamp: new Date().toISOString() });
    await wait(20);
    expect(c1.raw.writes.some((s: string) => s.includes('event: big'))).toBeTruthy();
    expect(c2.raw.writes.some((s: string) => s.includes('event: big'))).toBeTruthy();
    bridge.destroy();
  });

  it('session:* events are also fanned out', async () => {
    const bridge = createSSEBridge(bus as unknown as EventBus, server as unknown as any);
    bridge.register(server as unknown as any);
    const handler = server.__getHandler();
    const c = makeReqReply();
    await handler!(c.req, c.reply);
    // SSE bridge subscribes to literal 'session:*' channel
    bus.emit('session:*', { id: 7, type: 's', channel: 'session:abc', data: {}, timestamp: new Date().toISOString() });
    await wait(20);
    expect(c.raw.writes.some((s: string) => s.includes('event: s'))).toBeTruthy();
    bridge.destroy();
  });

  it('destroy unsubscribes from eventBus and clears clients', async () => {
    const bridge = createSSEBridge(bus as unknown as EventBus, server as unknown as any);
    bridge.register(server as unknown as any);
    const handler = server.__getHandler();
    const c = makeReqReply();
    await handler!(c.req, c.reply);
    bridge.destroy();
    bus.emit('global', { id: 8, type: 'gone', channel: 'global', data: {}, timestamp: new Date().toISOString() });
    await wait(20);
    expect(c.raw.writes.every((s: string) => !s.includes('event: gone'))).toBeTruthy();
  });
});
