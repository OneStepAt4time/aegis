/**
 * __tests__/SessionMetricsPanel.test.tsx — Issue 04 of the session-cockpit
 * epic.
 *
 * Pins the two visual/correctness fixes:
 *  1. Counts come from the transcript entries, not the server's
 *     `SessionMetrics.messages` count (kills the MESSAGES: 0 / 118K
 *     tokens contradiction).
 *  2. The 6-card emoji KPI grid is replaced by a single condensed banner
 *     under the cost hero.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import type { ParsedEntry, SessionMetrics } from '../types';
import { SessionMetricsPanel } from '../components/session/SessionMetricsPanel';
import { useSessionEventsStore } from '../store/useSessionEventsStore';

// ── Mocks ───────────────────────────────────────────────────────────

const getSessionMessagesMock = vi.fn();
const getSessionMetricsMock = vi.fn();
const subscribeSSEMock = vi.fn();

vi.mock('../api/client', () => ({
  getSessionMessages: (...args: unknown[]) => getSessionMessagesMock(...args),
  getSessionMetrics: (...args: unknown[]) => getSessionMetricsMock(...args),
  subscribeSSE: (...args: unknown[]) => subscribeSSEMock(...args),
}));

function entry(
  role: ParsedEntry['role'],
  contentType: ParsedEntry['contentType'],
): ParsedEntry {
  return { role, contentType, text: '' };
}

function metricsWithWrongCounts(): SessionMetrics {
  return {
    durationSec: 124,
    messages: 0, // intentional: server-side count out of sync
    toolCalls: 0,
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
  };
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  getSessionMessagesMock.mockReset();
  getSessionMetricsMock.mockReset();
  subscribeSSEMock.mockReset();
  subscribeSSEMock.mockReturnValue(() => {});

  act(() => {
    useSessionEventsStore.setState({ sessions: {} });
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────

describe('SessionMetricsPanel', () => {
  it('derives Messages and Tool calls from the transcript, not SessionMetrics', async () => {
    getSessionMessagesMock.mockResolvedValueOnce({
      messages: [
        entry('user', 'text'),
        entry('assistant', 'text'),
        entry('assistant', 'tool_use'),
        entry('assistant', 'tool_result'),
        entry('assistant', 'text'),
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });
    getSessionMetricsMock.mockResolvedValueOnce(metricsWithWrongCounts());

    const { findByText, queryAllByText } = render(
      <SessionMetricsPanel sessionId="sess-1" />,
    );

    // Cost hero renders.
    await findByText('$0.41');

    // Messages = 3 (user + 2 assistant text), not 0. Tool calls = 1.
    const threes = queryAllByText('3');
    const ones = queryAllByText('1');
    expect(threes.length).toBeGreaterThanOrEqual(1);
    expect(ones.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the condensed KPI banner (no 6-card emoji grid)', async () => {
    getSessionMessagesMock.mockResolvedValueOnce({
      messages: [],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });
    getSessionMetricsMock.mockResolvedValueOnce(metricsWithWrongCounts());

    const { findByText } = render(<SessionMetricsPanel sessionId="sess-2" />);

    // Labels in banner are lowercase-uppercase hybrid; assert new short labels.
    await findByText('Duration');
    await findByText('Messages');
    await findByText('Tool calls');
    await findByText('Approvals');
    await findByText('Auto');
    await findByText('Model');

    // The removed emoji-headed stat labels should NOT appear anywhere as
    // standalone card titles. The old "Auto-approvals" label is gone.
    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Auto-approvals');
    });
  });

  it('renders without crashing when the metrics endpoint fails', async () => {
    getSessionMessagesMock.mockResolvedValueOnce({
      messages: [],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });
    getSessionMetricsMock.mockRejectedValueOnce(new Error('no metrics'));

    const { findByText } = render(<SessionMetricsPanel sessionId="sess-3" />);

    await findByText('Estimated Cost');
    // Counts still render (as 0) even without a cost/token slice.
    await findByText('Messages');
  });
});
