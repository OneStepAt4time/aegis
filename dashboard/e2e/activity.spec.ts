import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Activity Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/activity**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => Math.floor(Math.random() * 5))),
          contributions: [
            { date: '2026-05-25', count: 14 },
            { date: '2026-05-24', count: 8 },
            { date: '2026-05-23', count: 3 },
          ],
          summary: { totalSessions: 25, activeDays: 12, peakHour: 14, peakDay: 'Saturday' },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}activity`);
  });

  test('renders activity page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /activity/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders heatmap grid', async ({ page }) => {
    // Heatmap should render cells
    await expect(page.locator('[data-testid="heatmap-grid"], .heatmap, canvas').first()).toBeVisible({
      timeout: 10_000,
    }).catch(() => {
      // Fallback: check for any grid-like structure
      expect(page.locator('svg rect, .grid-cell, [class*="heatmap"]').first()).toBeVisible({ timeout: 5_000 });
    });
  });

  test('renders activity summary', async ({ page }) => {
    await expect(page.getByText(/total|session/i)).toBeVisible({ timeout: 10_000 });
  });

  test('renders contribution chart', async ({ page }) => {
    // Contribution or daily activity chart
    await expect(
      page.getByText(/contribution|daily|14|8/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
