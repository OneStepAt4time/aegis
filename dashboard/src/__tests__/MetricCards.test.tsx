import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import MetricCards from '../components/overview/MetricCards';
import { useStore } from '../store/useStore';
import type { GlobalSSEEvent } from '../types';

const mockGetMetrics = vi.fn();
const mockGetHealth = vi.fn();

vi.mock('../api/client', () => ({
  getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

describe('MetricCards polling strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useStore.setState({
      metrics: null,
      activities: [],
      sseConnected: false,
      sseError: null,
    });

    mockGetMetrics.mockResolvedValue({
      uptime: 1,
      sessions: {
        total_created: 2,
        currently_active: 1,
        completed: 1,
        failed: 0,
        avg_duration_sec: 42,
        avg_messages_per_session: 3,
      },
      auto_approvals: 0,
      webhooks_sent: 0,
      webhooks_failed: 0,
      screenshots_taken: 0,
      pipelines_created: 0,
      batches_created: 0,
      prompt_delivery: {
        sent: 1,
        delivered: 1,
        failed: 0,
        success_rate: 100,
      },
      latency: {
        hook_latency_ms: { min: 2, max: 6, avg: 4, count: 2 },
        state_change_detection_ms: { min: 2, max: 6, avg: 4, count: 2 },
        permission_response_ms: { min: 20, max: 40, avg: 30, count: 2 },
        channel_delivery_ms: { min: 3, max: 7, avg: 5, count: 2 },
      },
    });

    mockGetHealth.mockResolvedValue({
      status: 'ok',
      version: 'test',
      uptime: 1,
      sessions: {
        active: 1,
        total: 2,
      },
      timestamp: new Date().toISOString(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses fallback polling when SSE is disconnected', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    render(<MetricCards />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    expect(mockGetHealth).toHaveBeenCalledTimes(1);

    const pollingCall = setTimeoutSpy.mock.calls.find((call) => call[1] === 10_000);
    expect(pollingCall).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(4);
    expect(mockGetHealth).toHaveBeenCalledTimes(4);
  });

  it('backs off polling when SSE is connected', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    useStore.setState({ sseConnected: true });

    render(<MetricCards />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    expect(mockGetHealth).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 30_000)).toBe(true);
  });

  it('debounces SSE-driven refreshes while connected', async () => {
    vi.useFakeTimers();
    useStore.setState({ sseConnected: true, activities: [] });

    render(<MetricCards />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    expect(mockGetHealth).toHaveBeenCalledTimes(1);

    const event: GlobalSSEEvent = {
      event: 'session_message',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      data: { text: 'hello' },
    };

    await act(async () => {
      useStore.getState().addActivity(event);
      useStore.getState().addActivity({ ...event, timestamp: new Date(Date.now() + 1).toISOString() });
      useStore.getState().addActivity({ ...event, timestamp: new Date(Date.now() + 2).toISOString() });
      await vi.advanceTimersByTimeAsync(999);
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    expect(mockGetHealth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTicks();
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(2);
    expect(mockGetHealth).toHaveBeenCalledTimes(2);
  });

  it('shows enhanced metric cards when data has non-zero values', async () => {
    vi.useFakeTimers();

    mockGetMetrics.mockResolvedValue({
      uptime: 3600,
      sessions: {
        total_created: 10,
        currently_active: 3,
        completed: 6,
        failed: 1,
        avg_duration_sec: 42,
        avg_messages_per_session: 5,
      },
      auto_approvals: 42,
      webhooks_sent: 18,
      webhooks_failed: 2,
      screenshots_taken: 7,
      pipelines_created: 4,
      batches_created: 2,
      prompt_delivery: {
        sent: 100,
        delivered: 95,
        failed: 5,
        success_rate: 95,
      },
      latency: {
        hook_latency_ms: { min: 2, max: 6, avg: 4, count: 2 },
        state_change_detection_ms: { min: 2, max: 6, avg: 4, count: 2 },
        permission_response_ms: { min: 20, max: 40, avg: 30, count: 2 },
        channel_delivery_ms: { min: 3, max: 7, avg: 5, count: 2 },
      },
    });

    const { getByText } = render(<MetricCards />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);

    // Core cards always visible
    expect(getByText('Active Sessions')).toBeDefined();
    expect(getByText('Total Created')).toBeDefined();
    expect(getByText('Delivery Rate')).toBeDefined();

    // Enhanced cards visible when non-zero
    expect(getByText('Completed')).toBeDefined();
    expect(getByText('Failed')).toBeDefined();
    expect(getByText('Prompts Delivered')).toBeDefined();
    expect(getByText('Prompts Failed')).toBeDefined();
    expect(getByText('Webhooks Sent')).toBeDefined();
    expect(getByText('Auto-Approvals')).toBeDefined();
    expect(getByText('Pipelines Created')).toBeDefined();
    expect(getByText('Batches Created')).toBeDefined();
    expect(getByText('Screenshots')).toBeDefined();
  });

  it('hides zero/null metric cards gracefully', async () => {
    vi.useFakeTimers();

    mockGetMetrics.mockResolvedValue({
      uptime: 1,
      sessions: {
        total_created: 0,
        currently_active: 0,
        completed: 0,
        failed: 0,
        avg_duration_sec: 0,
        avg_messages_per_session: 0,
      },
      auto_approvals: 0,
      webhooks_sent: 0,
      webhooks_failed: 0,
      screenshots_taken: 0,
      pipelines_created: 0,
      batches_created: 0,
      prompt_delivery: {
        sent: 0,
        delivered: 0,
        failed: 0,
        success_rate: null,
      },
      latency: {
        hook_latency_ms: { min: null, max: null, avg: null, count: 0 },
        state_change_detection_ms: { min: null, max: null, avg: null, count: 0 },
        permission_response_ms: { min: null, max: null, avg: null, count: 0 },
        channel_delivery_ms: { min: null, max: null, avg: null, count: 0 },
      },
    });

    const { queryByText } = render(<MetricCards />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);

    // These should not render when zero/null
    expect(queryByText('Completed')).toBeNull();
    expect(queryByText('Failed')).toBeNull();
    expect(queryByText('Prompts Delivered')).toBeNull();
    expect(queryByText('Prompts Failed')).toBeNull();
    expect(queryByText('Webhooks Sent')).toBeNull();
    expect(queryByText('Auto-Approvals')).toBeNull();
    expect(queryByText('Pipelines Created')).toBeNull();
    expect(queryByText('Batches Created')).toBeNull();
    expect(queryByText('Screenshots')).toBeNull();
  });

  it('shows an inline error instead of staying in a loading state when the initial load fails', async () => {
    mockGetMetrics.mockRejectedValue(new Error('metrics offline'));
    mockGetHealth.mockRejectedValue(new Error('health offline'));

    const { getByText, queryByText } = render(<MetricCards />);

    await waitFor(() => {
      expect(getByText('Unable to load overview metrics: metrics offline')).toBeDefined();
    }, { timeout: 10000 });

    expect(queryByText('Loading overview metrics...')).toBeNull();
  });

  it.skip('shows a polling fallback badge when SSE is degraded', async () => {
    useStore.setState({
      sseConnected: false,
      sseError: 'Real-time updates unavailable. Overview widgets are using fallback polling where available.',
    });

    const { getByText } = render(<MetricCards />);

    await waitFor(() => {
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    }, { timeout: 10000 });

    expect(getByText('Polling fallback')).toBeDefined();
  });
});
