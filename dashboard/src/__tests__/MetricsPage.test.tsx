/**
 * __tests__/MetricsPage.test.tsx — Issue #2087
 * Tests for Hephaestus's MetricsPage with aggregate API and charts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MetricsPage from '../pages/MetricsPage';
import { useAuthStore } from '../store/useAuthStore';
import * as client from '../api/client';

// Mock the API client
vi.mock('../api/client', () => ({
  getMetricsAggregate: vi.fn(),
}));

const mockAggregateResponse: client.AggregateMetricsResponse = {
  summary: {
    totalSessions: 142,
    avgDurationSeconds: 384,
    totalTokenCostUsd: 23.45,
    totalMessages: 3408,
    totalToolCalls: 12450,
    permissionsApproved: 130,
    permissionApprovalRate: 92,
    stalls: 3,
  },
  timeSeries: [
    { timestamp: '2026-04-01', sessions: 20, messages: 480, toolCalls: 1750, tokenCostUsd: 3.20 },
    { timestamp: '2026-04-02', sessions: 25, messages: 600, toolCalls: 2190, tokenCostUsd: 4.10 },
    { timestamp: '2026-04-03', sessions: 18, messages: 432, toolCalls: 1575, tokenCostUsd: 2.85 },
  ],
  byKey: [
    { keyId: 'key-1', keyName: 'production', sessions: 80, messages: 1920, toolCalls: 7000, tokenCostUsd: 13.20 },
    { keyId: 'key-2', keyName: 'staging', sessions: 62, messages: 1488, toolCalls: 5450, tokenCostUsd: 10.25 },
  ],
  anomalies: [
    { sessionId: 'sess-abc123', tokenCostUsd: 8.50, reason: 'p95 exceeded by 3x' },
  ],
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('MetricsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ token: 'test-token' });
    (client.getMetricsAggregate as ReturnType<typeof vi.fn>).mockResolvedValue(mockAggregateResponse);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders page header with title', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Metrics')).toBeTruthy();
    });
  });

  it('renders range selector buttons (7d, 30d, 90d)', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('7 Days')).toBeTruthy();
      expect(screen.getByText('30 Days')).toBeTruthy();
      expect(screen.getByText('90 Days')).toBeTruthy();
    });
  });

  it('renders granularity selector buttons (day, hour, key)', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('day')).toBeTruthy();
      expect(screen.getByText('hour')).toBeTruthy();
      expect(screen.getByText('key')).toBeTruthy();
    });
  });

  it('renders summary stat cards with data', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Sessions')).toBeTruthy();
      expect(screen.getByText('142')).toBeTruthy();
      expect(screen.getByText('Avg Duration')).toBeTruthy();
      expect(screen.getByText('Total Cost')).toBeTruthy();
      expect(screen.getByText('$23.45')).toBeTruthy();
      expect(screen.getByText('Approval Rate')).toBeTruthy();
      expect(screen.getByText('92%')).toBeTruthy();
    });
  });

  it('renders Sessions & Cost Over Time chart section', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Sessions & Cost Over Time')).toBeTruthy();
    });
  });

  it('renders Token Cost Trend chart section', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Token Cost Trend')).toBeTruthy();
    });
  });

  it('renders API key breakdown table', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Breakdown by API Key')).toBeTruthy();
      expect(screen.getByText('production')).toBeTruthy();
      expect(screen.getByText('staging')).toBeTruthy();
    });
  });

  it('renders anomaly alerts section', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Anomalous Sessions (1)')).toBeTruthy();
      expect(screen.getByText(/p95 exceeded by 3x/)).toBeTruthy();
    });
  });

  it('renders Export CSV button', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeTruthy();
    });
  });

  it('calls getMetricsAggregate on mount', async () => {
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(client.getMetricsAggregate).toHaveBeenCalled();
    });
  });

  it('shows error message when API fails', async () => {
    (client.getMetricsAggregate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Server error')
    );
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeTruthy();
    });
  });

  it('shows empty state when no sessions', async () => {
    (client.getMetricsAggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockAggregateResponse,
      summary: { ...mockAggregateResponse.summary, totalSessions: 0 },
      timeSeries: [],
      byKey: [],
      anomalies: [],
    });
    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText(/No session data found/)).toBeTruthy();
    });
  });
});
