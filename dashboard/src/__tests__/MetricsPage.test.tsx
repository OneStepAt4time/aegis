/**
 * __tests__/MetricsPage.test.tsx — Issue #2087
 *
 * Tests the MetricsPage component which calls getMetricsAggregate and renders
 * AggregateMetricsResponse data (summary cards, time-series chart, by-key table).
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MetricsPage from '../pages/MetricsPage';
import { useAuthStore } from '../store/useAuthStore';

/** Mock data matching the AggregateMetricsResponse shape used by MetricsPage. */
const mockMetricsResponse = {
  summary: {
    totalSessions: 142,
    avgDurationSeconds: 384,
    totalTokenCostUsd: 45.67,
    totalMessages: 3408,
    totalToolCalls: 512,
    permissionsApproved: 312,
    permissionApprovalRate: 92,
    stalls: 3,
  },
  timeSeries: [
    { timestamp: '2026-04-24T00:00:00Z', sessions: 20, messages: 480, toolCalls: 73, tokenCostUsd: 6.52 },
  ],
  byKey: [
    { keyId: 'key-1', keyName: 'production', sessions: 100, messages: 2400, toolCalls: 360, tokenCostUsd: 32.14 },
  ],
  anomalies: [],
};

describe('MetricsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    useAuthStore.setState({ token: 'test-token' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders placeholder dashes before data loads', () => {
    render(<MetricsPage />);
    // Four summary cards show "—" before the fetch resolves
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders summary stat cards when data loads', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetricsResponse),
    } as Response);

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Sessions')).toBeTruthy();
    });
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getByText('Avg Duration')).toBeTruthy();
    expect(screen.getByText('Total Cost')).toBeTruthy();
    expect(screen.getByText('Approval Rate')).toBeTruthy();
  });

  it('shows approval rate percentage', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetricsResponse),
    } as Response);

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('92%')).toBeTruthy();
    });
  });

  it('shows average duration formatted as minutes', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetricsResponse),
    } as Response);

    render(<MetricsPage />);
    await waitFor(() => {
      // formatDuration(384) → Math.round(384/60) = 6 → "6m"
      expect(screen.getByText('6m')).toBeTruthy();
    });
  });

  it('shows error state on API failure', async () => {
    // Simulate a network-level failure (fetch rejects).
    // This is more reliable than mocking ok:false because requestResponse
    // has complex error extraction that may not propagate in jsdom.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error'),
    );

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('renders time-series chart section when data loads', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetricsResponse),
    } as Response);

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Sessions & Cost Over Time/)).toBeTruthy();
    });
  });

  it('renders by-key breakdown table when data loads', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetricsResponse),
    } as Response);

    render(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Breakdown by API Key')).toBeTruthy();
    });
    expect(screen.getByText('production')).toBeTruthy();
  });
});
