import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/settings**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          theme: 'dark',
          fontSize: 14,
          locale: 'en',
          onboardingCompleted: true,
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}settings`);
  });

  test('renders settings page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /setting/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders theme selector', async ({ page }) => {
    await expect(
      page.getByLabel(/theme/i).or(page.getByRole('button', { name: /dark|light|theme/i })).or(page.getByText(/dark|light/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders locale or language option', async ({ page }) => {
    await expect(
      page.getByLabel(/language|locale/i).or(page.getByText(/english|italiano|language/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders font size option', async ({ page }) => {
    await expect(
      page.getByLabel(/font/i).or(page.getByText(/font size|text size/i))
    ).toBeVisible({ timeout: 10_000 });
  });
});
