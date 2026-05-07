/**
 * useAcpChat.test.ts — Tests for the ACP chat React hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAcpChat } from '../hooks/useAcpChat.js';

// Mock the API client
vi.mock('../api/acp-chat-client.js', () => ({
  sendPrompt: vi.fn(),
}));

import { sendPrompt } from '../api/acp-chat-client.js';
const mockedSendPrompt = vi.mocked(sendPrompt);

// Mock EventSource
interface MockESInstance {
  url: string;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
}

const mockEventSourceInstances: MockESInstance[] = [];

class MockEventSource {
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    mockEventSourceInstances.push(this as unknown as MockESInstance);
  }
}

// @ts-expect-error — mock EventSource
globalThis.EventSource = MockEventSource;

describe('useAcpChat', () => {
  beforeEach(() => {
    mockEventSourceInstances.length = 0;
    mockedSendPrompt.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with empty state', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: false }),
    );

    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionUsage).toBeUndefined();
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('connects to SSE on mount when autoConnect is true', () => {
    renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: true }),
    );

    expect(mockEventSourceInstances.length).toBe(1);
    expect(mockEventSourceInstances[0].url).toContain('/v1/sessions/sess-1/sse');
  });

  it('does not connect to SSE when autoConnect is false', () => {
    renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: false }),
    );

    expect(mockEventSourceInstances.length).toBe(0);
  });

  it('closes SSE on unmount', () => {
    const { unmount } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: true }),
    );

    expect(mockEventSourceInstances.length).toBe(1);
    unmount();
    expect(mockEventSourceInstances[0].close).toHaveBeenCalled();
  });

  it('sends prompt and optimistically adds user message', async () => {
    mockedSendPrompt.mockResolvedValueOnce({
      ok: true,
      delivered: true,
      attempts: 1,
    });

    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: false }),
    );

    await act(async () => {
      await result.current.sendPrompt('Hello, agent!');
    });

    // User message should be added
    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].role).toBe('user');
    expect(result.current.messages[0].content).toBe('Hello, agent!');

    // sendPrompt was called
    expect(mockedSendPrompt).toHaveBeenCalledWith('sess-1', 'Hello, agent!', expect.any(AbortSignal));
  });

  it('sets error when prompt delivery fails', async () => {
    mockedSendPrompt.mockResolvedValueOnce({
      ok: true,
      delivered: false,
      attempts: 1,
      reason: 'no_active_transport',
    });

    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: false }),
    );

    await act(async () => {
      await result.current.sendPrompt('test');
    });

    expect(result.current.error).toBe('no_active_transport');
  });

  it('sets error on sendPrompt exception', async () => {
    mockedSendPrompt.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: false }),
    );

    await act(async () => {
      await result.current.sendPrompt('test');
    });

    expect(result.current.error).toBe('Network error');
  });

  it('clears error with clearError', async () => {
    mockedSendPrompt.mockRejectedValueOnce(new Error('fail'));

    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: false }),
    );

    await act(async () => {
      await result.current.sendPrompt('test');
    });

    expect(result.current.error).toBe('fail');

    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });

  it('handles SSE message.delta events', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: true }),
    );

    const es = mockEventSourceInstances[0];
    expect(es).toBeTruthy();

    // Simulate a message.delta event
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'msg-1',
          role: 'assistant',
          content: 'Hello',
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].content).toBe('Hello');
    expect(result.current.messages[0].isStreaming).toBe(true);
    expect(result.current.isGenerating).toBe(true);
  });

  it('appends content to existing streaming message on subsequent deltas', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: true }),
    );

    const es = mockEventSourceInstances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'msg-1',
          role: 'assistant',
          content: 'Hello',
        }),
      } as unknown as MessageEvent);
    });

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'msg-1',
          content: ' world',
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].content).toBe('Hello world');
  });

  it('handles message.complete event', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: true }),
    );

    const es = mockEventSourceInstances[0];

    // Start streaming
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'msg-1',
          role: 'assistant',
          content: 'Hi',
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.messages[0].isStreaming).toBe(true);

    // Complete
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.complete',
          messageId: 'msg-1',
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.messages[0].isStreaming).toBe(false);
  });

  it('handles turn.completed event', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: true }),
    );

    const es = mockEventSourceInstances[0];

    // Start generating
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'message.delta',
          messageId: 'msg-1',
          role: 'assistant',
          content: 'Hi',
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.isGenerating).toBe(true);

    // Turn completed
    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'turn.completed',
          messageId: 'msg-1',
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.isGenerating).toBe(false);
  });

  it('handles usage.updated event', () => {
    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: true }),
    );

    const es = mockEventSourceInstances[0];

    act(() => {
      es.onmessage!({
        data: JSON.stringify({
          type: 'usage.updated',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 20,
            cacheWriteTokens: 10,
            totalTokens: 180,
          },
        }),
      } as unknown as MessageEvent);
    });

    expect(result.current.sessionUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      totalTokens: 180,
    });
  });

  it('stop() sets isGenerating to false', async () => {
    mockedSendPrompt.mockReturnValue(new Promise(() => {})); // Never resolves

    const { result } = renderHook(() =>
      useAcpChat({ sessionId: 'sess-1', autoConnect: false }),
    );

    act(() => {
      result.current.sendPrompt('test');
    });

    // Is generating (optimistic)
    await waitFor(() => expect(result.current.isGenerating).toBe(true));

    act(() => {
      result.current.stop();
    });

    expect(result.current.isGenerating).toBe(false);
  });
});
