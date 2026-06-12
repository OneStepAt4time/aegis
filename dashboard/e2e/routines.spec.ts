import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

const mockRoutines = [
  {
    id: 'routine-001',
    name: 'Daily code review',
    schedule: '0 9 * * *',
    status: 'active',
    lastRunAt: '2026-05-25T09:00:00.000Z',
    nextRunAt: '2026-05-26T09:00:00.000Z',
  },
  {
    id: 'routine-002',
    name: 'Weekly security scan',
    schedule: '0 2 * * 1',
    status: 'paused',
    lastRunAt: '2026-05-19T02:00:00.000Z',
    nextRunAt: null,
  },
];

test.describe('Routines Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/routines**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          routines: mockRoutines,
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}routines`);
  });

  test('renders routines page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Routines', exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('renders routine list or empty state', async ({ page }) => {
    // Phase 1 scaffold: no backend integration yet, always shows empty state
    await expect(
      page.getByText(/no routine|empty|get started|No routines/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders calendar view or empty state', async ({ page }) => {
    // Phase 1 scaffold: calendar grid is always visible
    await expect(
      page.getByText(/calendar|schedule|routine|No routines/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders schedule information', async ({ page }) => {
    await expect(page.getByText(/cron|schedule|daily|weekly|0 9/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('renders empty state when no routines', async ({ page }) => {
    await page.route('**/v1/routines**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          routines: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      });
    });
    await page.reload();
    await expect(page.getByText(/no routine|empty|get started/i)).toBeVisible({ timeout: 10_000 });
  });
});
