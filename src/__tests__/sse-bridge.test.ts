import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventBus, BusEvent, BusEventHandler } from '../event-bus.js';

class MockEventBus implements EventBus {
  handlers = new Map<string, Set<BusEventHandler>>();
  events: BusEvent[] = [];
  nextId = 1;

  publish(channel: string, type: string, data: Record<string, unknown>): number {
    const id = this.nextId++;
    const ev: BusEvent = { channel, id, type, timestamp: new Date().toISOString(), data };
    this.events.push(ev);
    for (const [pattern, handlers] of this.handlers.entries()) {
      if (pattern === channel || pattern.includes('*')) {
        for (const h of handlers) h(ev);
      }
    }
    return id;
  }

  subscribe(channel: string, handler: BusEventHandler): () => void {
    let set = this.handlers.get(channel);
    if (!set) { set = new Set(); this.handlers.set(channel, set); }
    set.add(handler);
    return () => set!.delete(handler);
  }

  async replaySince(channel: string, lastEventId: number): Promise<BusEvent[]> {
    return this.events.filter(e => e.channel === channel && e.id > lastEventId);
  }

  destroy(): void {
    this.handlers.clear();
  }
}

function createMockFastify() {
  const routes: Array<{ method: string; url: string; handler: (req: any, reply: any) => void }> = [];
  return {
    get: vi.fn((url: string, opts: any, handler: (req: any, reply: any) => void) => {
      // Fastify .get(url, opts, handler) or .get(url, handler)
      const actualHandler = typeof opts === 'function' ? opts : handler;
      routes.push({ method: 'GET', url, handler: actualHandler });
    }),
    _routes: routes,
  } as any;
}

function createMockReqReply(query: Record<string, string> = {}) {
  const written: string[] = [];
  const headers: Record<string, string> = {};
  const raw = {
    setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }),
    write: vi.fn((data: string) => { written.push(data); return true; }),
    _written: written,
    _headers: headers,
  };
  const closeHandlers: Array<() => void> = [];
  return {
    request: { query, raw: { on: vi.fn((event: string, handler: () => void) => { if (event === 'close') closeHandlers.push(handler); }) }, id: 'test-req' },
    reply: { raw, _closeHandlers: closeHandlers },
    written,
  };
}

describe('SSE Bridge', () => {
  let eventBus: MockEventBus;
  let mockFastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    eventBus = new MockEventBus();
    mockFastify = createMockFastify();
  });

  it('registers /sse route on the Fastify server', async () => {
    const { createSSEBridge } = await import('../services/sse-bridge.js');
    const bridge = createSSEBridge(eventBus, mockFastify as any);
    bridge.register(mockFastify as any);
    expect(mockFastify.get).toHaveBeenCalled();
    bridge.destroy();
  });

  it('sends SSE events to connected clients', async () => {
    const { createSSEBridge } = await import('../services/sse-bridge.js');
    const bridge = createSSEBridge(eventBus, mockFastify as any);
    bridge.register(mockFastify as any);

    const { request, reply, written } = createMockReqReply();
    const handler = mockFastify._routes[0].handler;
    await handler(request, reply);

    eventBus.publish('global', 'test', { foo: 'bar' });

    const output = written.join('');
    expect(output).toContain('event: test');
    expect(output).toContain('"foo":"bar"');

    bridge.destroy();
  });

  it('replays events when lastEventId is provided', async () => {
    const { createSSEBridge } = await import('../services/sse-bridge.js');
    const bridge = createSSEBridge(eventBus, mockFastify as any);
    bridge.register(mockFastify as any);

    eventBus.publish('global', 'before1', {});
    eventBus.publish('global', 'before2', {});

    const { request, reply, written } = createMockReqReply({ lastEventId: '1' });
    const handler = mockFastify._routes[0].handler;
    await handler(request, reply);

    const output = written.join('');
    expect(output).toContain('before2');

    bridge.destroy();
  });

  it('removes client on connection close', async () => {
    const { createSSEBridge } = await import('../services/sse-bridge.js');
    const bridge = createSSEBridge(eventBus, mockFastify as any);
    bridge.register(mockFastify as any);

    const { request, reply, written } = createMockReqReply();
    const handler = mockFastify._routes[0].handler;
    await handler(request, reply);

    for (const h of reply._closeHandlers) h();

    const lenBefore = written.length;
    eventBus.publish('global', 'after-close', {});
    expect(written.length).toBe(lenBefore);

    bridge.destroy();
  });

  it('destroy unsubscribes from EventBus', async () => {
    const { createSSEBridge } = await import('../services/sse-bridge.js');
    const bridge = createSSEBridge(eventBus, mockFastify as any);
    bridge.register(mockFastify as any);

    const { request, reply, written } = createMockReqReply();
    await mockFastify._routes[0].handler(request, reply);

    bridge.destroy();

    const lenBefore = written.length;
    eventBus.publish('global', 'post-destroy', {});
    expect(written.length).toBe(lenBefore);
  });

  it('sets correct SSE headers', async () => {
    const { createSSEBridge } = await import('../services/sse-bridge.js');
    const bridge = createSSEBridge(eventBus, mockFastify as any);
    bridge.register(mockFastify as any);

    const { request, reply } = createMockReqReply();
    await mockFastify._routes[0].handler(request, reply);

    expect(reply.raw._headers['Content-Type']).toBe('text/event-stream');
    expect(reply.raw._headers['Cache-Control']).toBe('no-cache');
    expect(reply.raw._headers['Connection']).toBe('keep-alive');

    bridge.destroy();
  });
});
