/**
 * __tests__/MetricsPage.test.tsx — Issue #2087
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MetricsPage from '../pages/MetricsPage';

const mockGetMetricsAggregate = vi.fn();

vi.mock('../api/client', () => ({
  getMetricsAggregate: (...args: unknown[]) => mockGetMetricsAggregate(...args),
}));

const mockMetricsResponse = {
  summary: {
    totalSessions: 142,
    avgDurationSeconds: 384,
    totalTokenCostUsd: 12.5,
    totalMessages: 3408,
    totalToolCalls: 426,
    permissionsApproved: 312,
    permissionApprovalRate: 92,
    stalls: 2,
  },
  timeSeries: [
    { timestamp: '2026-04-18T10:00:00Z', sessions: 20, messages: 480, toolCalls: 60, tokenCostUsd: 1.8 },
    { timestamp: '2026-04-19T10:00:00Z', sessions: 25, messages: 600, toolCalls: 75, tokenCostUsd: 2.25 },
  ],
  byKey: [
    { keyId: 'key-1', keyName: 'admin-key', sessions: 100, messages: 2400, toolCalls: 300, tokenCostUsd: 9.0 },
    { keyId: 'key-2', keyName: 'viewer-key', sessions: 42, messages: 1008, toolCalls: 126, tokenCostUsd: 3.5 },
  ],
  anomalies: [],
};

describe('MetricsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders placeholder dashes while loading', () => {
    mockGetMetricsAggregate.mockReturnValue(new Promise(() => {}));
    render(<MetricsPage />);
    // Summary cards show — while data is null
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it('renders summary stat cards when data loads', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsResponse);

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
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsResponse);

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('92%')).toBeTruthy();
    });
  });

  it('shows average duration formatted', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsResponse);

    render(<MetricsPage />);
    await waitFor(() => {
      // 384 seconds → 6m (Math.round(384/60) = 6)
      expect(screen.getByText('6m')).toBeTruthy();
    });
  });

  it('shows error state', async () => {
    mockGetMetricsAggregate.mockRejectedValue(new Error('Failed to load metrics'));

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load metrics')).toBeTruthy();
    });
  });

  it('renders range and granularity controls', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsResponse);

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('7 Days')).toBeTruthy();
      expect(screen.getByText('30 Days')).toBeTruthy();
      expect(screen.getByText('90 Days')).toBeTruthy();
    });
  });

  it('renders by-key breakdown table when data has keys', async () => {
    mockGetMetricsAggregate.mockResolvedValue(mockMetricsResponse);

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Breakdown by API Key')).toBeTruthy();
      expect(screen.getByText('admin-key')).toBeTruthy();
      expect(screen.getByText('viewer-key')).toBeTruthy();
    });
  });

  it('renders anomaly alerts when anomalies exist', async () => {
    mockGetMetricsAggregate.mockResolvedValue({
      ...mockMetricsResponse,
      anomalies: [
        { sessionId: 'abc-123-def', tokenCostUsd: 50, reason: 'Token cost exceeds p95 by 5x' },
      ],
    });

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Anomalous Sessions/)).toBeTruthy();
      expect(screen.getByText(/Token cost exceeds p95 by 5x/)).toBeTruthy();
    });
  });
});
