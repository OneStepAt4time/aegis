/**
 * BudgetAlertBanner.test.tsx — Tests for budget alert banner component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { BudgetAlertBanner } from '../BudgetAlertBanner';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('BudgetAlertBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when budget alerts are disabled', async () => {
    localStorage.setItem('aegis:settings', JSON.stringify({
      budgetDailyCapUsd: 100,
      budgetMonthlyCapUsd: 1000,
      budgetAlertEnabled: false,
    }));

    await act(async () => {
      render(<BudgetAlertBanner />);
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing when no settings exist', async () => {
    await act(async () => {
      render(<BudgetAlertBanner />);
      vi.advanceTimersByTime(100);
    });

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows warning when approaching budget', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('aegis:settings', JSON.stringify({
      budgetDailyCapUsd: 100,
      budgetMonthlyCapUsd: 1000,
      budgetAlertEnabled: true,
    }));

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        dailyTrends: [
          { date: todayStr, estimatedCostUsd: 85, sessions: 5 },
        ],
      }),
    });

    await act(async () => {
      render(<BudgetAlertBanner />);
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('shows critical alert when budget exceeded', async () => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    localStorage.setItem('aegis:settings', JSON.stringify({
      budgetDailyCapUsd: 50,
      budgetMonthlyCapUsd: 1000,
      budgetAlertEnabled: true,
    }));

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        dailyTrends: [
          { date: todayStr, estimatedCostUsd: 60, sessions: 5 },
        ],
      }),
    });

    await act(async () => {
      render(<BudgetAlertBanner />);
      await vi.advanceTimersByTimeAsync(1000);
    });

    const alert = screen.getByRole('alert');
    expect(alert).toBeDefined();
    expect(alert.textContent).toContain('exceeded');
  });
});
