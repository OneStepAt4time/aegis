import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAcpChat } from '../useAcpChat';

// Mock API
vi.mock('../../api/acp-chat-client.js', () => ({
  sendPrompt: vi.fn().mockResolvedValue({ delivered: true }),
}));

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() { this.closed = true; }

  static reset() { MockEventSource.instances = []; }
}

beforeEach(() => {
  MockEventSource.reset();
  vi.stubGlobal('EventSource', MockEventSource);
});

describe('useAcpChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionUsage).toBeUndefined();
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('exposes sendPrompt, stop, and clearError', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    expect(typeof result.current.sendPrompt).toBe('function');
    expect(typeof result.current.stop).toBe('function');
    expect(typeof result.current.clearError).toBe('function');
  });

  it('creates SSE connection on mount', () => {
    renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain('/v1/sessions/s1/sse');
  });

  it('skips SSE when autoConnect is false', () => {
    renderHook(() =>
      useAcpChat({ sessionId: 's1', autoConnect: false }),
    );

    expect(MockEventSource.instances.length).toBe(0);
  });

  it('closes SSE on unmount', () => {
    const { unmount } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];
    unmount();
    expect(es.closed).toBe(true);
  });

  it('handles message.delta SSE event', async () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'm1',
          role: 'assistant',
          content: 'Hello',
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
      expect(result.current.messages[0].content).toBe('Hello');
      expect(result.current.messages[0].isStreaming).toBe(true);
    });
  });

  it('appends content on subsequent message.delta events', async () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'm1',
          role: 'assistant',
          content: 'Hello',
        }),
      });
    });

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'm1',
          content: ' world',
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.messages[0].content).toBe('Hello world');
    });
  });

  it('handles message.complete event', async () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'm1',
          role: 'assistant',
          content: 'Hi',
        }),
      });
    });

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.complete',
          messageId: 'm1',
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.messages[0].isStreaming).toBe(false);
    });
  });

  it('handles turn.completed event', async () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'm1',
          role: 'assistant',
          content: 'test',
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(true);
    });

    act(() => {
      es.onmessage!({
        data: JSON.stringify({ type: 'turn.completed' }),
      });
    });

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(false);
    });
  });

  it('handles usage.updated event', async () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];
    const usage = { totalTokens: 100, inputTokens: 50, outputTokens: 50 };

    act(() => {
      es.onmessage!({
        data: JSON.stringify({ type: 'usage.updated', usage }),
      });
    });

    await waitFor(() => {
      expect(result.current.sessionUsage).toEqual(usage);
    });
  });

  it('sends prompt and adds user message', async () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    await act(async () => {
      await result.current.sendPrompt('Hello!');
    });

    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0].content).toBe('Hello!');
  });

  it('sets error when sendPrompt fails', async () => {
    const { sendPrompt } = await import('../../api/acp-chat-client.js');
    vi.mocked(sendPrompt).mockRejectedValueOnce(new Error('Network fail'));

    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    await act(async () => {
      await result.current.sendPrompt('test');
    });

    expect(result.current.error).toBe('Network fail');
  });

  it('clears error via clearError', async () => {
    const { sendPrompt } = await import('../../api/acp-chat-client.js');
    vi.mocked(sendPrompt).mockRejectedValueOnce(new Error('err'));

    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    await act(async () => {
      await result.current.sendPrompt('test');
    });

    expect(result.current.error).toBe('err');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('stops generation via stop', async () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 's1' }),
    );

    const es = MockEventSource.instances[0];
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'm1',
          role: 'assistant',
          content: 'gen',
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.isGenerating).toBe(true);
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.isGenerating).toBe(false);
  });
});
