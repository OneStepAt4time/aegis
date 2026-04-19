import { test, expect } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';
const SESSION_HISTORY_RESPONSE = {
  records: [
    {
      id: 'sess-critical-001',
      ownerKeyId: 'admin-key',
      createdAt: Math.floor(Date.now() / 1000) - 3600,
      lastSeenAt: Math.floor(Date.now() / 1000),
      finalStatus: 'active',
      source: 'audit+live',
    },
  ],
  pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
};

test.describe('Critical Path E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/sessions/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SESSION_HISTORY_RESPONSE),
      });
    });
  });

  // 1. Dashboard loads and renders overview
  test('overview page loads and renders heading and sessions text', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);
    await expect(page.getByRole('heading', { name: /overview/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();
  });

  // 2. Login page renders and stays on login without token
  test('login page stays on /login without valid token', async ({ page }) => {
    await page.goto(`${DASHBOARD_BASE_URL}login`);
    const submitButton = page.getByRole('button', { name: /login|submit|enter|sign/i });
    await expect(submitButton).toBeVisible({ timeout: 10_000 });
    // Click without filling token
    await submitButton.click();
    // Should remain on login page
    await expect(page).toHaveURL(/login/);
  });

  // 3. Session history page renders with search input
  test('session history page renders search input', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);
    await page.getByRole('link', { name: /session history/i }).click();
    await expect(page.getByPlaceholder(/search|filter/i)).toBeVisible({ timeout: 10_000 });
  });

  // 4. Session detail page renders for a known session
  test('session detail page renders content for a known session', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);
    await page.getByRole('link', { name: 'Quiet docs sync' }).click();
    await expect(page.getByText('Quiet docs sync').first()).toBeVisible({ timeout: 10_000 });
  });

  // 5. Theme toggle changes data-theme attribute on settings page
  test('theme toggle changes data-theme on settings page', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);
    await page.getByRole('link', { name: /settings/i }).click();
    const themeButton = page.getByRole('button', { name: /dark|light/i });
    await expect(themeButton).toBeVisible({ timeout: 10_000 });

    const themeBefore = await page.locator('html').getAttribute('data-theme');
    await themeButton.click();
    const themeAfter = await page.locator('html').getAttribute('data-theme');
    expect(themeAfter).not.toBe(themeBefore);
  });

  // 6. CSV export button is visible on session history page
  test('CSV export button is present on session history page', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);
    await page.getByRole('link', { name: /session history/i }).click();
    const exportBtn = page.getByRole('button', { name: /export|csv/i });
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });
  });

  // 7. SSE connection indicator visible on overview
  test('SSE status indicator shows Live or Polling', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);
    await expect(page.getByText(/^(Live|Polling)$/i)).toBeVisible({ timeout: 15_000 });
  });

});
