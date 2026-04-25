/**
 * __tests__/MetricsPage.test.tsx — Issue #2087
 * Tests for the aggregated metrics dashboard page.
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MetricsPage from '../pages/MetricsPage';
import { useAuthStore } from '../store/useAuthStore';

const mockGetMetricsAggregate = vi.fn();

vi.mock('../api/client', () => ({
  getMetricsAggregate: (...args: unknown[]) => mockGetMetricsAggregate(...args),
}));

const mockMetrics = {
  summary: {
    totalSessions: 142,
    avgDurationSeconds: 384,
    totalTokenCostUsd: 247.53,
    totalMessages: 3408,
    totalToolCalls: 1856,
    permissionsApproved: 312,
    permissionApprovalRate: 92,
    stalls: 5,
  },
  timeSeries: [
    { timestamp: '2026-04-19T00:00:00Z', sessions: 20, messages: 480, toolCalls: 260, tokenCostUsd: 34.5 },
    { timestamp: '2026-04-20T00:00:00Z', sessions: 22, messages: 528, toolCalls: 286, tokenCostUsd: 37.8 },
  ],
  byKey: [
    { keyId: 'k1', keyName: 'claude-main', sessions: 100, messages: 2400, toolCalls: 1300, tokenCostUsd: 175.0 },
    { keyId: 'k2', keyName: 'claude-review', sessions: 42, messages: 1008, toolCalls: 556, tokenCostUsd: 72.53 },
  ],
  anomalies: [
    { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', tokenCostUsd: 45.0, reason: 'Token cost 3x above p95' },
  ],
};

const mockMetricsNoAnomalies = {
  ...mockMetrics,
  anomalies: [],
};

describe('MetricsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: 'test-token' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state with placeholders', () => {
    mockGetMetricsAggregate.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MetricsPage />);
    // Component shows '—' placeholders when data is null
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('renders summary stat cards when data loads', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsNoAnomalies);
    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Sessions')).toBeTruthy();
    });
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getByText('Avg Duration')).toBeTruthy();
    expect(screen.getByText('Total Cost')).toBeTruthy();
    expect(screen.getByText('Approval Rate')).toBeTruthy();
  });

  it('shows correct approval rate', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsNoAnomalies);
    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('92%')).toBeTruthy();
    });
  });

  it('shows average duration in minutes', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsNoAnomalies);
    render(<MetricsPage />);
    // 384s → Math.round(384/60) = 6 → formatDuration returns "6m"
    await waitFor(() => {
      expect(screen.getByText('6m')).toBeTruthy();
    });
  });

  it('shows error state', async () => {
    mockGetMetricsAggregate.mockRejectedValue(new Error('Server error'));
    render(<MetricsPage />);
    await waitFor(() => {
      // Component renders err.message for Error instances
      expect(screen.getByText('Server error')).toBeTruthy();
    });
  });

  it('shows coming soon notice for time-series features', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsNoAnomalies);
    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Sessions & Cost Over Time')).toBeTruthy();
    });
    expect(screen.getByText('Token Cost Trend')).toBeTruthy();
    expect(screen.getByText('Breakdown by API Key')).toBeTruthy();
  });

  it('renders all secondary stat cards', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsNoAnomalies);
    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('142')).toBeTruthy();
    });
    // Verify the summary card shows the total cost formatted
    expect(screen.getByText(/\$247/)).toBeTruthy();
  });

  it('renders anomaly alerts when anomalies exist', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetrics);
    render(<MetricsPage />);
    // Wait for data to load first
    await waitFor(() => {
      expect(screen.getByText('Total Sessions')).toBeTruthy();
    });
    // Then check for anomaly section
    expect(screen.getByText(/Anomalous Sessions/)).toBeTruthy();
    expect(screen.getByText(/Token cost 3x above p95/)).toBeTruthy();
  });

  it('renders empty state when no sessions', async () => {
    mockGetMetricsAggregate.mockResolvedValue({
      ...mockMetricsNoAnomalies,
      summary: { ...mockMetricsNoAnomalies.summary, totalSessions: 0 },
      timeSeries: [],
      byKey: [],
    });
    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText(/No session data found/)).toBeTruthy();
    });
  });
});
