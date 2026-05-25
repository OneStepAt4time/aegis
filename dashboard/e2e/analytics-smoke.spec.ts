/**
 * e2e/analytics-smoke.spec.ts — Smoke tests for the Analytics page.
 *
 * Verifies the analytics page renders its main sections:
 * KPI banner, model distribution, cost trends, and rate-limit charts.
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    // Mock analytics-specific endpoints
    await page.route('**/v1/analytics/summary**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalSessions: 12,
          totalTokens: 45000,
          totalCostUsd: 1.26,
          avgSessionDurationSec: 1800,
          modelBreakdown: [
            { model: 'claude-sonnet-4-20250514', tokens: 30000, costUsd: 0.90, sessions: 8 },
            { model: 'claude-opus-4-20250514', tokens: 12000, costUsd: 0.30, sessions: 3 },
            { model: 'claude-haiku-3-20250414', tokens: 3000, costUsd: 0.06, sessions: 1 },
          ],
          dailyUsage: [
            { date: '2026-05-23', sessions: 3, tokens: 12000, costUsd: 0.35 },
            { date: '2026-05-24', sessions: 5, tokens: 18000, costUsd: 0.52 },
            { date: '2026-05-25', sessions: 4, tokens: 15000, costUsd: 0.39 },
          ],
          topKeys: [
            { keyId: 'admin-key', sessions: 8, tokens: 35000, costUsd: 1.00 },
            { keyId: 'user-key', sessions: 4, tokens: 10000, costUsd: 0.26 },
          ],
        }),
      });
    });

    await page.route('**/v1/analytics/rate-limits**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          activeSessions: 4,
          maxConcurrentSessions: 10,
          rateLimitStatus: 'healthy',
          recentLimits: [],
          forecast: { projectedSessions: 6, projectedTokens: 60000, riskLevel: 'low' },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}analytics`);
  });

  test('renders analytics page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /analytics/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders KPI banner with key metrics', async ({ page }) => {
    // KPI banner should show total sessions, tokens, cost
    await expect(page.getByText(/12.*sessions/i)).toBeVisible({ timeout: 10_000 });
  });

  test('renders model distribution section', async ({ page }) => {
    await expect(page.getByText(/sonnet|opus|haiku/i)).toBeVisible({ timeout: 10_000 });
  });

  test('renders rate limit status', async ({ page }) => {
    // Rate limit chart or forecast card should be visible
    const rateLimitSection = page.getByText(/rate.?limit|concurrent/i).first();
    await expect(rateLimitSection).toBeVisible({ timeout: 10_000 });
  });

  test('page is accessible — has main landmark', async ({ page }) => {
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 10_000 });
  });
});
