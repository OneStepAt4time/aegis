import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Metrics Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/analytics**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summary: {
            totalSessions: 12,
            avgDurationSec: 1800,
            avgMessagesPerSession: 24,
            totalTokens: 9600,
            totalCostUsd: 1.26,
            approvalRate: 0.85,
          },
          timeSeries: Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            sessions: Math.floor(Math.random() * 5),
            messages: Math.floor(Math.random() * 50),
            costUsd: Math.random() * 0.5,
          })),
          models: {
            'claude-sonnet-4-20250514': { count: 8, tokens: 6400, costUsd: 0.84 },
            'claude-haiku-3-20250414': { count: 4, tokens: 3200, costUsd: 0.42 },
          },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}metrics`);
  });

  test('renders metrics page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /metric/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders time series data', async ({ page }) => {
    // Should show chart or time-based data
    await expect(
      page.locator('svg, canvas, [class*="chart"], [class*="recharts"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders model breakdown', async ({ page }) => {
    await expect(page.getByText(/sonnet|haiku|model/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('renders summary KPIs', async ({ page }) => {
    await expect(page.getByText(/session|token|cost/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
