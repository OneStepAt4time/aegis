import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import MetricCards from '../components/overview/MetricCards';
import { useStore } from '../store/useStore';

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
      sseConnected: false,
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
    vi.restoreAllMocks();
  });

  it('uses fallback polling when SSE is disconnected', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    render(<MetricCards />);

    await waitFor(() => {
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      expect(mockGetHealth).toHaveBeenCalledTimes(1);
    });

    const pollingCall = setIntervalSpy.mock.calls.find((call) => call[1] === 10_000);
    expect(pollingCall).toBeDefined();
    const intervalCallback = pollingCall?.[0] as () => void | Promise<void>;

    await act(async () => {
      await intervalCallback?.();
      await intervalCallback?.();
      await intervalCallback?.();
    });

    await waitFor(() => {
      expect(mockGetMetrics).toHaveBeenCalledTimes(4);
      expect(mockGetHealth).toHaveBeenCalledTimes(4);
    });
  });

  it('does not run interval polling when SSE is connected', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    useStore.setState({ sseConnected: true });

    render(<MetricCards />);

    await waitFor(() => {
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      expect(mockGetHealth).toHaveBeenCalledTimes(1);
    });

    const pollingCall = setIntervalSpy.mock.calls.find((call) => call[1] === 10_000);
    expect(pollingCall).toBeUndefined();
    expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    expect(mockGetHealth).toHaveBeenCalledTimes(1);
  });
});
