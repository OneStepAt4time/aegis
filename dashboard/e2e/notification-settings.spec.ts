import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Notification Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/settings/notification**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          telegram: { connected: false, chatId: null },
          slack: { connected: false, webhookUrl: null },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}settings/notifications`);
  });

  test('renders notification settings heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /notification/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders Telegram section', async ({ page }) => {
    await expect(page.getByText(/telegram/i)).toBeVisible({ timeout: 10_000 });
  });

  test('renders connect or disconnect option for Telegram', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /connect|disconnect|telegram/i }).or(page.getByText(/not connected|connect/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders Slack or webhook section', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Webhook Delivery History' })
    ).toBeVisible({ timeout: 10_000 });
  });
});
