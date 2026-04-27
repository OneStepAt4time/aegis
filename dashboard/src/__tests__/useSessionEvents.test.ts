/**
 * __tests__/useSessionEvents.test.ts — Integration tests for the single
 * session-event store + hook. Issue 07 of the `session-cockpit` epic.
 *
 * The purpose of this test suite is to pin down the contract that makes
 * the "MESSAGES: 0 next to 118K tokens" bug impossible: counts and
 * entries derive from the same array.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ParsedEntry, SessionMetrics, UIState } from '../types';
import { useSessionEvents } from '../hooks/useSessionEvents';
import {
  useSessionEventsStore,
  selectMessageCount,
  selectToolCallCount,
  selectUserMessageCount,
  selectAssistantMessageCount,
  selectSession,
} from '../store/useSessionEventsStore';

// ── Mocks ───────────────────────────────────────────────────────────

const getSessionMessagesMock = vi.fn();
const getSessionMetricsMock = vi.fn();
const subscribeSSEMock = vi.fn();

vi.mock('../api/client', () => ({
  getSessionMessages: (...args: unknown[]) => getSessionMessagesMock(...args),
  getSessionMetrics: (...args: unknown[]) => getSessionMetricsMock(...args),
  subscribeSSE: (...args: unknown[]) => subscribeSSEMock(...args),
}));

// ── Fixtures ────────────────────────────────────────────────────────

function entry(
  role: ParsedEntry['role'],
  contentType: ParsedEntry['contentType'],
  text = 'x',
): ParsedEntry {
  return { role, contentType, text };
}

function messagesResponse(messages: ParsedEntry[], status: UIState = 'idle') {
  return { messages, status, statusText: null, interactiveContent: null };
}

function metricsResponse(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    durationSec: 120,
    messages: 999, // intentionally wrong — we must not surface this
    toolCalls: 999,
    approvals: 0,
    autoApprovals: 0,
    statusChanges: [],
    tokenUsage: {
      inputTokens: 116_800,
      outputTokens: 1_700,
      cacheCreationTokens: 0,
      cacheReadTokens: 129_700,
      estimatedCostUsd: 0.414,
    },
    ...overrides,
  };
}

// ── Setup ───────────────────────────────────────────────────────────

let sseHandler: ((event: { data: string }) => void) | null = null;
const unsubscribeMock = vi.fn();

beforeEach(() => {
  getSessionMessagesMock.mockReset();
  getSessionMetricsMock.mockReset();
  subscribeSSEMock.mockReset();
  unsubscribeMock.mockReset();
  sseHandler = null;

  subscribeSSEMock.mockImplementation((_id, handler) => {
    sseHandler = handler;
    return unsubscribeMock;
  });

  // Reset the shared store between tests.
  act(() => {
    useSessionEventsStore.setState({ sessions: {} });
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function emitSse(eventType: string) {
  if (!sseHandler) throw new Error('SSE handler not registered');
  sseHandler({
    data: JSON.stringify({
      event: eventType,
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
    }),
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('useSessionEvents — initial load', () => {
  it('populates entries and counts from getSessionMessages', async () => {
    getSessionMessagesMock.mockResolvedValueOnce(
      messagesResponse([
        entry('user', 'text', 'Review my README'),
        entry('assistant', 'text', 'Here are the issues…'),
        entry('assistant', 'tool_use', ''),
        entry('assistant', 'tool_result', ''),
        entry('assistant', 'text', 'Summary:'),
      ]),
    );
    getSessionMetricsMock.mockResolvedValueOnce(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));

    await waitFor(() => {
      expect(result.current.state.entries).toHaveLength(5);
    });

    expect(result.current.counts.messages).toBe(3);
    expect(result.current.counts.userMessages).toBe(1);
    expect(result.current.counts.assistantMessages).toBe(2);
    expect(result.current.counts.toolCalls).toBe(1);
  });

  it('sets loading=false after first successful fetch', async () => {
    getSessionMessagesMock.mockResolvedValueOnce(messagesResponse([]));
    getSessionMetricsMock.mockResolvedValueOnce(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));

    expect(result.current.state.loading).toBe(true);

    await waitFor(() => expect(result.current.state.loading).toBe(false));
  });

  it('stores metrics (tokens/cost) but derives counts locally', async () => {
    getSessionMessagesMock.mockResolvedValueOnce(
      messagesResponse([entry('user', 'text'), entry('assistant', 'text')]),
    );
    getSessionMetricsMock.mockResolvedValueOnce(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));

    await waitFor(() =>
      expect(result.current.state.metrics?.tokenUsage?.estimatedCostUsd).toBe(0.414),
    );

    // The metrics endpoint lied about counts (999 / 999). Our derived
    // counts ignore that and stay consistent with the entries array.
    expect(result.current.counts.messages).toBe(2);
    expect(result.current.counts.toolCalls).toBe(0);
    expect(result.current.state.metrics?.messages).toBe(999);
  });

  it('exposes the error on a failed fetch', async () => {
    getSessionMessagesMock.mockRejectedValueOnce(new Error('boom'));
    getSessionMetricsMock.mockResolvedValueOnce(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));

    await waitFor(() => expect(result.current.state.error).toBe('boom'));
    expect(result.current.state.loading).toBe(false);
  });
});

describe('useSessionEvents — SSE updates', () => {
  it('refetches entries when a "message" SSE event fires', async () => {
    getSessionMessagesMock
      .mockResolvedValueOnce(messagesResponse([entry('user', 'text')]))
      .mockResolvedValueOnce(
        messagesResponse([
          entry('user', 'text'),
          entry('assistant', 'text'),
          entry('assistant', 'tool_use'),
        ]),
      );
    getSessionMetricsMock.mockResolvedValue(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));

    await waitFor(() => expect(result.current.state.entries).toHaveLength(1));
    expect(result.current.counts.messages).toBe(1);

    act(() => {
      emitSse('message');
    });

    await waitFor(() => expect(result.current.state.entries).toHaveLength(3), {
      timeout: 2000,
    });
    expect(result.current.counts.messages).toBe(2);
    expect(result.current.counts.toolCalls).toBe(1);
  });

  it('increments approvalCount on "approval" SSE event', async () => {
    getSessionMessagesMock.mockResolvedValue(messagesResponse([]));
    getSessionMetricsMock.mockResolvedValue(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    act(() => {
      emitSse('approval');
      emitSse('approval');
      emitSse('approval');
    });

    await waitFor(() => expect(result.current.counts.approvals).toBe(3));
  });

  it('increments statusChanges on "status" SSE event', async () => {
    getSessionMessagesMock.mockResolvedValue(messagesResponse([]));
    getSessionMetricsMock.mockResolvedValue(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    act(() => {
      emitSse('status');
      emitSse('status');
    });

    await waitFor(() => expect(result.current.counts.statusChanges).toBe(2));
  });

  it('ignores malformed SSE payloads', async () => {
    getSessionMessagesMock.mockResolvedValue(messagesResponse([]));
    getSessionMetricsMock.mockResolvedValue(metricsResponse());

    const { result } = renderHook(() => useSessionEvents('sess-1'));
    await waitFor(() => expect(result.current.state.loading).toBe(false));

    act(() => {
      if (!sseHandler) throw new Error('handler missing');
      sseHandler({ data: '{not json' });
      sseHandler({ data: JSON.stringify({ wrong: 'shape' }) });
    });

    // No state change, no crash.
    expect(result.current.state.error).toBeNull();
  });

  it('unsubscribes on unmount', async () => {
    getSessionMessagesMock.mockResolvedValue(messagesResponse([]));
    getSessionMetricsMock.mockResolvedValue(metricsResponse());

    const { unmount } = renderHook(() => useSessionEvents('sess-1'));
    await waitFor(() => expect(subscribeSSEMock).toHaveBeenCalled());

    unmount();
    expect(unsubscribeMock).toHaveBeenCalled();
  });
});

describe('useSessionEvents — cross-session isolation', () => {
  it('two sessions do not share entries or counters', async () => {
    getSessionMessagesMock.mockImplementation((id: string) => {
      if (id === 'sess-a') {
        return Promise.resolve(
          messagesResponse([entry('user', 'text'), entry('assistant', 'text')]),
        );
      }
      return Promise.resolve(messagesResponse([entry('user', 'text')]));
    });
    getSessionMetricsMock.mockResolvedValue(metricsResponse());

    const a = renderHook(() => useSessionEvents('sess-a'));
    const b = renderHook(() => useSessionEvents('sess-b'));

    await waitFor(() => {
      expect(a.result.current.counts.messages).toBe(2);
      expect(b.result.current.counts.messages).toBe(1);
    });
  });
});

describe('selectors (pure)', () => {
  it('selectMessageCount counts only user+assistant text entries', () => {
    const state = {
      ...useSessionEventsStore.getState().sessions['x'],
      entries: [
        entry('user', 'text'),
        entry('assistant', 'text'),
        entry('assistant', 'thinking'),
        entry('assistant', 'tool_use'),
        entry('system', 'text'),
      ],
    } as unknown as Parameters<typeof selectMessageCount>[0];

    expect(selectMessageCount(state)).toBe(2);
    expect(selectToolCallCount(state)).toBe(1);
    expect(selectUserMessageCount(state)).toBe(1);
    expect(selectAssistantMessageCount(state)).toBe(1);
  });

  it('selectSession returns a fresh empty state for unknown sessions', () => {
    const store = useSessionEventsStore.getState();
    const s = selectSession(store, 'never-seen');

    expect(s.entries).toEqual([]);
    expect(s.loading).toBe(true);
    expect(s.approvalCount).toBe(0);
  });
});
