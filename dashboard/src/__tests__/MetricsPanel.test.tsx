import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import MetricsPanel from '../components/overview/MetricsPanel';
import { useStore } from '../store/useStore';

const mockGetMetrics = vi.fn();
const mockGetHealth = vi.fn();

vi.mock('../api/client', () => ({
  getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

const MOCK_HEALTH = {
  status: 'ok',
  version: '2.5.0',
  uptime: 3600,
  sessions: {
    active: 3,
    total: 42,
  },
  timestamp: new Date().toISOString(),
};

const MOCK_METRICS = {
  uptime: 3600,
  sessions: {
    total_created: 42,
    currently_active: 3,
    completed: 30,
    failed: 2,
    avg_duration_sec: 245,
    avg_messages_per_session: 8,
  },
  auto_approvals: 5,
  webhooks_sent: 10,
  webhooks_failed: 0,
  screenshots_taken: 0,
  pipelines_created: 2,
  batches_created: 1,
  prompt_delivery: {
    sent: 100,
    delivered: 98,
    failed: 2,
    success_rate: 98,
  },
  latency: {
    hook_latency_ms: { min: 2, max: 6, avg: 4, count: 10 },
    state_change_detection_ms: { min: 2, max: 6, avg: 4, count: 10 },
    permission_response_ms: { min: 20, max: 40, avg: 30, count: 10 },
    channel_delivery_ms: { min: 3, max: 7, avg: 5, count: 10 },
  },
};

describe('MetricsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    useStore.setState({
      metrics: null,
      activities: [],
      sseConnected: false,
      sseError: null,
    });

    mockGetMetrics.mockResolvedValue(MOCK_METRICS);
    mockGetHealth.mockResolvedValue(MOCK_HEALTH);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders without crashing', async () => {
    const { container } = render(<MetricsPanel />);
    expect(container).toBeDefined();
  });

  it('shows loading skeleton initially', () => {
    mockGetMetrics.mockReturnValue(new Promise(() => {}));
    mockGetHealth.mockReturnValue(new Promise(() => {}));

    const { container } = render(<MetricsPanel />);
    expect(container.querySelector('.animate-pulse')).toBeDefined();
  });

  it('shows metrics data when available', async () => {
    const { getByText } = render(<MetricsPanel />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(getByText('Active Sessions')).toBeDefined();
    expect(getByText('Total Sessions')).toBeDefined();
    expect(getByText('Avg Duration')).toBeDefined();
    expect(getByText('Uptime')).toBeDefined();
    expect(getByText('3')).toBeDefined();
    expect(getByText('42')).toBeDefined();
  });

  it('shows placeholder when both endpoints fail', async () => {
    mockGetMetrics.mockRejectedValue(new Error('404'));
    mockGetHealth.mockRejectedValue(new Error('Network error'));

    const { getByText } = render(<MetricsPanel />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(getByText('Metrics endpoint unavailable — showing placeholder values.')).toBeDefined();
    expect(getByText('Active Sessions')).toBeDefined();
    expect(getByText('Total Sessions')).toBeDefined();
  });

  it('uses health-only data when metrics endpoint fails', async () => {
    mockGetMetrics.mockRejectedValue(new Error('404'));

    const { getByText, queryByText } = render(<MetricsPanel />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(getByText('Active Sessions')).toBeDefined();
    expect(getByText('42')).toBeDefined();
    expect(queryByText('Metrics endpoint unavailable')).toBeNull();
  });

  it('formats avg duration correctly', async () => {
    const { getByText } = render(<MetricsPanel />);

    await act(async () => {
      await vi.runAllTicks();
    });

    // 245 seconds = 4m 5s
    expect(getByText('4m 5s')).toBeDefined();
  });

  it('formats uptime correctly', async () => {
    const { getByText } = render(<MetricsPanel />);

    await act(async () => {
      await vi.runAllTicks();
    });

    // 3600 seconds = 1h
    expect(getByText('1h')).toBeDefined();
  });
});
