import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../i18n/context';
import CostPage from '../pages/CostPage';
import type { AnalyticsCostsResponse, CostSummaryResponse, CostByModelResponse } from '../types';

const mockGetAnalyticsCosts = vi.fn();
const mockGetCostSummary = vi.fn();
const mockGetCostByModel = vi.fn();
const mockGetSessions = vi.fn();
const mockGetBudgetSettings = vi.fn();

vi.mock('../api/client', () => ({
  getAnalyticsCosts: (...args: unknown[]) => mockGetAnalyticsCosts(...args),
  getCostSummary: (...args: unknown[]) => mockGetCostSummary(...args),
  getCostByModel: (...args: unknown[]) => mockGetCostByModel(...args),
  getSessions: (...args: unknown[]) => mockGetSessions(...args),
}));

vi.mock('../store/useStore', () => ({
  useStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel({ sseConnected: false, sseError: null })),
}));

vi.mock('../utils/budgetSettings', () => ({
  getBudgetSettings: () => mockGetBudgetSettings(),
}));

const mockCostsResponse: AnalyticsCostsResponse = {
  totalCostUsd: 45.67,
  totalSessions: 42,
  byModel: [
    { model: 'claude-sonnet-4.6', estimatedCostUsd: 30.00, inputTokens: 100000, outputTokens: 50000, cacheCreationTokens: 20000, cacheReadTokens: 10000 },
    { model: 'claude-opus-4.7', estimatedCostUsd: 15.67, inputTokens: 40000, outputTokens: 30000, cacheCreationTokens: 0, cacheReadTokens: 5000 },
  ],
  byKey: [
    { keyId: 'key-1', keyName: 'ops-primary', estimatedCostUsd: 45.67, sessions: 42, messages: 500 },
  ],
  dailyTrends: [
    { date: '2026-05-17', estimatedCostUsd: 5.20, sessions: 5 },
    { date: '2026-05-18', estimatedCostUsd: 8.30, sessions: 8 },
    { date: '2026-05-19', estimatedCostUsd: 7.75, sessions: 6 },
    { date: '2026-05-20', estimatedCostUsd: 12.42, sessions: 10 },
    { date: '2026-05-21', estimatedCostUsd: 6.00, sessions: 7 },
    { date: '2026-05-22', estimatedCostUsd: 4.00, sessions: 4 },
    { date: '2026-05-23', estimatedCostUsd: 2.00, sessions: 2 },
  ],
  generatedAt: '2026-05-23T06:00:00.000Z',
};

const mockCostSummary: CostSummaryResponse = {
  from: null,
  to: null,
  totalInputTokens: 140000,
  totalOutputTokens: 80000,
  totalCacheCreationTokens: 20000,
  totalCacheReadTokens: 15000,
  cacheHitRate: 0.35,
  estimatedCostUsd: 45.67,
  burnRateUsdPerHour: 1.50,
  sessions: 42,
};

const mockCostByModel: CostByModelResponse = {
  from: null,
  to: null,
  models: [
    { model: 'claude-sonnet-4.6', inputTokens: 100000, outputTokens: 50000, cacheCreationTokens: 20000, cacheReadTokens: 10000, estimatedCostUsd: 30.00, cacheHitRate: 0.40 },
    { model: 'claude-opus-4.7', inputTokens: 40000, outputTokens: 30000, cacheCreationTokens: 0, cacheReadTokens: 5000, estimatedCostUsd: 15.67, cacheHitRate: 0.25 },
  ],
  totalModels: 2,
  totalCostUsd: 45.67,
};

const emptySessionsResponse = {
  sessions: [],
  pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
};

function setupMocks(overrides?: { costs?: AnalyticsCostsResponse | null; summary?: CostSummaryResponse | null; byModel?: CostByModelResponse | null }) {
  mockGetAnalyticsCosts.mockResolvedValue(overrides?.costs ?? mockCostsResponse);
  mockGetCostSummary.mockResolvedValue(overrides?.summary ?? mockCostSummary);
  mockGetCostByModel.mockResolvedValue(overrides?.byModel ?? mockCostByModel);
  mockGetSessions.mockResolvedValue(emptySessionsResponse);
  mockGetBudgetSettings.mockReturnValue({ budgetDailyCapUsd: 100, budgetMonthlyCapUsd: 1000, budgetAlertEnabled: true });
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <I18nProvider>
        <CostPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('CostPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton state with header', () => {
    mockGetAnalyticsCosts.mockReturnValue(new Promise(() => {}));
    mockGetCostSummary.mockReturnValue(new Promise(() => {}));
    mockGetCostByModel.mockReturnValue(new Promise(() => {}));
    mockGetSessions.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Cost & Billing')).toBeDefined();
  });

  it('shows empty state when no cost data', async () => {
    const emptyCosts: AnalyticsCostsResponse = {
      totalCostUsd: 0,
      totalSessions: 0,
      byModel: [],
      byKey: [],
      dailyTrends: [],
      generatedAt: '2026-05-23T06:00:00.000Z',
    };
    setupMocks({ costs: emptyCosts });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No cost data yet')).toBeDefined();
    });
  });

  it('shows error state when data fetch fails', async () => {
    // Promise.allSettled absorbs rejections; getAnalyticsCosts rejection
    // means costData stays null → component falls through to empty/error.
    // Synchronous throw bypasses allSettled and hits outer catch → dataError set.
    mockGetAnalyticsCosts.mockImplementation(() => { throw new Error('Server error'); });
    mockGetCostSummary.mockResolvedValue(mockCostSummary);
    mockGetCostByModel.mockResolvedValue(mockCostByModel);
    mockGetSessions.mockResolvedValue(emptySessionsResponse);
    mockGetBudgetSettings.mockReturnValue({ budgetDailyCapUsd: 100, budgetMonthlyCapUsd: 1000, budgetAlertEnabled: true });

    renderPage();

    await waitFor(() => {
      // ErrorState renders the error message
      expect(screen.getAllByText('Server error').length).toBeGreaterThan(0);
    });
  });

  it('fetches and displays cost data with model names', async () => {
    setupMocks();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Cost & Billing')).toBeDefined();
    });

    // Model names should be visible in the model breakdown
    expect(screen.getAllByText('claude-sonnet-4.6').length).toBeGreaterThan(0);
    expect(screen.getAllByText('claude-opus-4.7').length).toBeGreaterThan(0);
  });

  it('displays time range picker with 7d, 30d, and 90d options', async () => {
    setupMocks();

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '7 Days' })).toBeDefined();
    });
    expect(screen.getByRole('button', { name: '30 Days' })).toBeDefined();
    expect(screen.getByRole('button', { name: '90 Days' })).toBeDefined();
  });

  it('switches active time range on click', async () => {
    setupMocks();

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '7 Days' })).toBeDefined();
    });

    const sevenDayBtn = screen.getByRole('button', { name: '7 Days' });
    fireEvent.click(sevenDayBtn);

    expect(sevenDayBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders budget overview section with disabled alerts', async () => {
    // NOTE: BudgetOverview has a rule-of-hooks violation — useT() is called
    // inside a conditional return. When budgetAlertEnabled=false, the
    // warning path may not render correctly. This test verifies the page
    // still renders without crashing when alerts are disabled.
    setupMocks();
    mockGetBudgetSettings.mockReturnValue({ budgetDailyCapUsd: 100, budgetMonthlyCapUsd: 1000, budgetAlertEnabled: false });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Cost & Billing')).toBeDefined();
    });

    // Page renders without crashing even with budget alerts disabled
    await waitFor(() => {
      expect(screen.getByText(/Daily Spend/)).toBeDefined();
    });
  });

  it('renders budget overview section when budgetAlertEnabled is true', async () => {
    setupMocks();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Cost & Billing')).toBeDefined();
    });

    // Budget overview section should be present (BudgetProgressBar renders within it)
    // The component renders daily + monthly progress bars and a forecast chart
    await waitFor(() => {
      expect(screen.getByText(/Daily Spend/)).toBeDefined();
    });
  });

  it('handles zero-cost edge case showing empty state', async () => {
    const zeroCostResponse: AnalyticsCostsResponse = {
      ...mockCostsResponse,
      totalCostUsd: 0,
      byModel: [],
      dailyTrends: mockCostsResponse.dailyTrends.map(d => ({ ...d, estimatedCostUsd: 0 })),
    };
    setupMocks({ costs: zeroCostResponse });

    renderPage();

    await waitFor(() => {
      // All daily costs are zero → hasData check fails → empty state
      expect(screen.getByText('No cost data yet')).toBeDefined();
    });
  });
});
