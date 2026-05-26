import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Cost Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/cost**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalCostUsd: 1.26,
          totalInputTokens: 4800,
          totalOutputTokens: 4500,
          byModel: {
            'claude-sonnet-4-20250514': { costUsd: 0.84, inputTokens: 3200, outputTokens: 3000, sessions: 3 },
            'claude-haiku-3-20250414': { costUsd: 0.42, inputTokens: 1600, outputTokens: 1500, sessions: 1 },
          },
          byDay: [
            { date: '2026-05-25', costUsd: 0.73, sessions: 3 },
            { date: '2026-05-24', costUsd: 0.53, sessions: 2 },
          ],
          period: { from: '2026-05-01', to: '2026-05-26' },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}cost`);
  });

  test('renders cost page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /cost/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders total cost summary', async ({ page }) => {
    await expect(page.getByText(/\$?1\.26/)).toBeVisible({ timeout: 10_000 });
  });

  test('renders cost by model breakdown', async ({ page }) => {
    await expect(page.getByText(/sonnet|haiku/i)).toBeVisible({ timeout: 10_000 });
  });

  test('renders date filter controls', async ({ page }) => {
    await expect(
      page.getByLabel(/date|range|from|period/i).or(page.getByRole('button', { name: /filter|date|period/i }))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders empty state when no cost data', async ({ page }) => {
    await page.route('**/v1/cost**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          totalCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          byModel: {},
          byDay: [],
          period: { from: '2026-05-01', to: '2026-05-26' },
        }),
      });
    });
    await page.reload();
    await expect(page.getByText(/no cost|no data|no session/i)).toBeVisible({ timeout: 10_000 });
  });
});
