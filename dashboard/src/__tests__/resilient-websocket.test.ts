import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResilientWebSocket } from '../api/resilient-websocket';

describe('ResilientWebSocket', () => {
  let latestWs: {
    onopen: (() => void) | null;
    onmessage: ((e: { data: unknown }) => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
  } | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    latestWs = null;
    vi.stubGlobal('WebSocket', class MockWebSocket {
      static OPEN = 1;
      static CLOSED = 3;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      readyState = 1; // OPEN

      constructor(_url: string) {
        latestWs = this;
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a WebSocket connection on construction', () => {
    const rws = new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn() });
    expect(latestWs).not.toBeNull();
    rws.close();
  });

  it('sends auth token as first message on open', () => {
    new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn() }, 'my-token');

    latestWs!.onopen!();

    expect(latestWs!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: 'my-token' }));
  });

  it('calls onMessage when a message is received', () => {
    const onMessage = vi.fn();
    new ResilientWebSocket('ws://localhost/ws', { onMessage });

    latestWs!.onmessage!({ data: JSON.stringify({ type: 'output', text: 'hello' }) });

    expect(onMessage).toHaveBeenCalledWith({ type: 'output', text: 'hello' });
  });

  it('ignores malformed messages', () => {
    const onMessage = vi.fn();
    new ResilientWebSocket('ws://localhost/ws', { onMessage });

    latestWs!.onmessage!({ data: 'not json' });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('calls onOpen callback when connection opens', () => {
    const onOpen = vi.fn();
    new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn(), onOpen });

    latestWs!.onopen!();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does not call callbacks after close()', () => {
    const onMessage = vi.fn();
    const onOpen = vi.fn();
    const rws = new ResilientWebSocket('ws://localhost/ws', { onMessage, onOpen });
    rws.close();

    latestWs!.onopen!();
    latestWs!.onmessage!({ data: JSON.stringify({ test: true }) });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('sends data when WebSocket is open', () => {
    const rws = new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn() });
    latestWs!.onopen!();

    rws.send({ type: 'input', text: 'hello' });

    expect(latestWs!.send).toHaveBeenCalledWith(JSON.stringify({ type: 'input', text: 'hello' }));
    rws.close();
  });

  it('does not send data when WebSocket is not open', () => {
    latestWs = null;
    vi.stubGlobal('WebSocket', class MockWebSocket {
      static OPEN = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      send = vi.fn();
      close = vi.fn();
      readyState = 0; // CONNECTING

      constructor(_url: string) {
        latestWs = this;
      }
    });

    const rws = new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn() });
    rws.send({ type: 'input', text: 'hello' });

    expect(latestWs!.send).not.toHaveBeenCalled();
    rws.close();
  });

  it('calls onReconnecting when connection drops', () => {
    const onReconnecting = vi.fn();
    new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn(), onReconnecting });

    latestWs!.onclose!();

    expect(onReconnecting).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('does not reconnect after close()', () => {
    const onReconnecting = vi.fn();
    const rws = new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn(), onReconnecting });
    rws.close();

    latestWs!.onclose!();

    expect(onReconnecting).not.toHaveBeenCalled();
  });

  it('handles onerror without crashing', () => {
    new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn() });

    expect(() => latestWs!.onerror!()).not.toThrow();
  });

  it('closes WebSocket on close()', () => {
    const rws = new ResilientWebSocket('ws://localhost/ws', { onMessage: vi.fn() });

    rws.close();

    expect(latestWs!.close).toHaveBeenCalled();
  });
});
