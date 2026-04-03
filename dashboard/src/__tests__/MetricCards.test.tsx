import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
      auto_approvals: 2,
      webhooks_sent: 5,
      webhooks_failed: 1,
      screenshots_taken: 4,
      pipelines_created: 2,
      batches_created: 1,
      prompt_delivery: {
        sent: 4,
        delivered: 3,
        failed: 1,
        success_rate: 75,
      },
      latency: {
        hook_latency_ms: { min: 10, max: 40, avg: 25, count: 3 },
        state_change_detection_ms: { min: 12, max: 38, avg: 24, count: 3 },
        permission_response_ms: { min: 100, max: 300, avg: 180, count: 2 },
        channel_delivery_ms: { min: 20, max: 60, avg: 35, count: 4 },
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
<<<<<<< HEAD
    vi.restoreAllMocks();

  it('uses fallback polling when SSE is disconnected', async () => {

    it('uses fallback polling when SSE is disconnected', async () => {
      vi.useFakeTimers();

      render(<MetricCards />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      expect(mockGetHealth).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
        await Promise.resolve();
      });

      expect(mockGetMetrics).toHaveBeenCalledTimes(4);
      expect(mockGetHealth).toHaveBeenCalledTimes(4);
    });

    it('renders expanded overview cards and latency comparison', async () => {
      render(<MetricCards />);

      expect(await screen.findByText('Auto-approvals')).toBeDefined();
      expect(screen.getByText('Webhooks')).toBeDefined();
      expect(screen.getByText('Pipelines')).toBeDefined();
      expect(screen.getByText('Latency Comparison')).toBeDefined();
      expect(screen.getByLabelText('Global latency comparison')).toBeDefined();
      expect(screen.getByText('3 delivered / 1 failed')).toBeDefined();
    });

    it('does not run interval polling when SSE is connected', async () => {
      vi.useFakeTimers();

    render(<MetricCards />);

    await act(async () => {
  });

  it('renders expanded overview cards and latency comparison', async () => {
    render(<MetricCards />);

    expect(await screen.findByText('Auto-approvals')).toBeDefined();
    expect(screen.getByText('Webhooks')).toBeDefined();
    expect(screen.getByText('Pipelines')).toBeDefined();
    expect(screen.getByText('Latency Comparison')).toBeDefined();
    expect(screen.getByLabelText('Global latency comparison')).toBeDefined();
    expect(screen.getByText('3 delivered / 1 failed')).toBeDefined();
  });

  it('does not run interval polling when SSE is connected', async () => {
    vi.useFakeTimers();
>>>>>>> 6cdbbc4 (fix: add dashboard latency metrics visualization)
    useStore.setState({ sseConnected: true });

    render(<MetricCards />);

<<<<<<< HEAD
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
=======
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    expect(mockGetHealth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(mockGetMetrics).toHaveBeenCalledTimes(1);
    expect(mockGetHealth).toHaveBeenCalledTimes(1);
  });

  it('shows a latency empty state when metrics have no latency samples', async () => {
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

    render(<MetricCards />);

    expect(await screen.findByText('Latency samples will appear after hooks, approvals, and deliveries are recorded.')).toBeDefined();
  });
});
