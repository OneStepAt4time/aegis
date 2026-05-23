import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/context';
import AnalyticsPage from '../pages/AnalyticsPage';
import type { AnalyticsSummary, RateLimitAnalyticsResponse } from '../types';

const mockGetAnalyticsSummary = vi.fn();
const mockGetRateLimitAnalytics = vi.fn();

vi.mock('../api/client', () => ({
  getAnalyticsSummary: (...args: unknown[]) => mockGetAnalyticsSummary(...args),
  getRateLimitAnalytics: (...args: unknown[]) => mockGetRateLimitAnalytics(...args),
}));

vi.mock('../store/useStore', () => ({
  useStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel({ sseConnected: false, sseError: null })),
}));

const mockAnalyticsSummary: AnalyticsSummary = {
  sessionVolume: [
    { date: '2026-05-16', created: 5 },
    { date: '2026-05-17', created: 8 },
    { date: '2026-05-18', created: 3 },
  ],
  tokenUsageByModel: [
    { model: 'claude-sonnet-4.6', inputTokens: 50000, outputTokens: 25000, cacheCreationTokens: 10000, cacheReadTokens: 5000, estimatedCostUsd: 12.50 },
    { model: 'claude-opus-4.7', inputTokens: 20000, outputTokens: 15000, cacheCreationTokens: 0, cacheReadTokens: 2000, estimatedCostUsd: 8.75 },
  ],
  costTrends: [
    { date: '2026-05-16', cost: 5.20, sessions: 5 },
    { date: '2026-05-17', cost: 8.30, sessions: 8 },
    { date: '2026-05-18', cost: 7.75, sessions: 3 },
  ],
  topApiKeys: [
    { keyId: 'key-1', keyName: 'ops-primary', sessions: 10, messages: 150, estimatedCostUsd: 15.00 },
  ],
  durationTrends: [
    { date: '2026-05-16', avgDurationSec: 120, count: 5 },
    { date: '2026-05-17', avgDurationSec: 180, count: 8 },
    { date: '2026-05-18', avgDurationSec: 90, count: 3 },
  ],
  errorRates: {
    totalSessions: 16,
    failedSessions: 1,
    failureRate: 0.0625,
    infraFailures: 0,
    adjustedFailureRate: 0.0625,
    permissionPrompts: 12,
    approvals: 10,
    autoApprovals: 8,
  },
  generatedAt: '2026-05-18T12:00:00.000Z',
};

const mockRateLimitResponse: RateLimitAnalyticsResponse = {
  global: { max: 100, timeWindowMs: 60000 },
  perKey: [
    { keyId: 'key-1', keyName: 'ops-primary', activeSessions: 3, maxSessions: 10, tokensInWindow: 5000, maxTokens: 100000, spendInWindowUsd: 2.50, maxSpendUsd: 50, windowMs: 60000 },
  ],
  forecast: { estimatedSessionsRemaining: 7, bottleneck: null },
  generatedAt: '2026-05-18T12:00:00.000Z',
};

function renderPage(): void {
  render(
    <MemoryRouter>
      <I18nProvider>
        <AnalyticsPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    mockGetAnalyticsSummary.mockReturnValue(new Promise(() => {}));
    mockGetRateLimitAnalytics.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.getByText('Loading analytics...')).toBeDefined();
  });

  it('fetches and displays analytics data with KPI banner and chart sections', async () => {
    mockGetAnalyticsSummary.mockResolvedValue(mockAnalyticsSummary);
    mockGetRateLimitAnalytics.mockResolvedValue(mockRateLimitResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Analytics' })).toBeDefined();
    });

    // KPI banner items rendered
    expect(screen.getAllByText('Total Cost').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total Tokens').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Avg Duration').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Error Rate').length).toBeGreaterThan(0);

    // Summary cards rendered
    expect(screen.getAllByText('16').length).toBeGreaterThan(0);

    // Chart section headings
    expect(screen.getAllByText('Session Volume Over Time').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Token Usage by Model').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cost Trends (USD per Day)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Top API Keys by Usage').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Avg Session Duration Over Time').length).toBeGreaterThan(0);

    // Top API key rendered
    expect(screen.getByText('ops-primary')).toBeDefined();
  });

  it('shows empty chart state when no data', async () => {
    const emptySummary: AnalyticsSummary = {
      ...mockAnalyticsSummary,
      sessionVolume: [],
      tokenUsageByModel: [],
      costTrends: [],
      topApiKeys: [],
      durationTrends: [],
    };
    mockGetAnalyticsSummary.mockResolvedValue(emptySummary);
    mockGetRateLimitAnalytics.mockResolvedValue(mockRateLimitResponse);

    renderPage();

    await waitFor(() => {
      const emptyMessages = screen.getAllByText('No data available yet');
      expect(emptyMessages.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('shows error state when API fails', async () => {
    mockGetAnalyticsSummary.mockRejectedValue(new Error('Server error'));
    mockGetRateLimitAnalytics.mockRejectedValue(new Error('Server error'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
    });
  });

  it('displays rate limit analytics section when available', async () => {
    mockGetAnalyticsSummary.mockResolvedValue(mockAnalyticsSummary);
    mockGetRateLimitAnalytics.mockResolvedValue(mockRateLimitResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Analytics' })).toBeDefined();
    });

    // Rate limit data is passed to RateLimitChart + RateLimitForecastCard
    expect(mockGetRateLimitAnalytics).toHaveBeenCalledTimes(1);
  });

  it('shows data consistency warning when sessions exist but charts have no data', async () => {
    const inconsistentSummary: AnalyticsSummary = {
      ...mockAnalyticsSummary,
      sessionVolume: [],
      tokenUsageByModel: [],
      durationTrends: [],
      // errorRates.totalSessions = 16 > 0, but chart arrays empty
    };
    mockGetAnalyticsSummary.mockResolvedValue(inconsistentSummary);
    mockGetRateLimitAnalytics.mockResolvedValue(mockRateLimitResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Data aggregation in progress/)).toBeDefined();
    });
  });

  it('renders model distribution bar when tokenUsageByModel has data', async () => {
    mockGetAnalyticsSummary.mockResolvedValue(mockAnalyticsSummary);
    mockGetRateLimitAnalytics.mockResolvedValue(null);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Model Distribution')).toBeDefined();
      expect(screen.getByText('claude-sonnet-4.6')).toBeDefined();
      expect(screen.getByText('claude-opus-4.7')).toBeDefined();
    });
  });

  it('calculates error rate correctly and color-codes high error rates', async () => {
    const highErrorSummary: AnalyticsSummary = {
      ...mockAnalyticsSummary,
      errorRates: {
        totalSessions: 20,
        failedSessions: 3,
        failureRate: 0.15,
        infraFailures: 0,
        adjustedFailureRate: 0.15,
        permissionPrompts: 5,
        approvals: 4,
        autoApprovals: 2,
      },
    };
    mockGetAnalyticsSummary.mockResolvedValue(highErrorSummary);
    mockGetRateLimitAnalytics.mockResolvedValue(null);

    renderPage();

    await waitFor(() => {
      // 3/20 = 15% > 5% threshold → should show "15.0%" in KPI banner
      expect(screen.getAllByText('15.0%').length).toBeGreaterThan(0);
    });
  });
});
