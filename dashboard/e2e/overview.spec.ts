import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Overview Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);
    await page.goto(`${DASHBOARD_BASE_URL}`);
  });

  test('renders overview heading or session table', async ({ page }) => {
    // Overview is the landing page — should show sessions or a heading
    await expect(
      page.getByRole('heading', { name: /overview|sessions|dashboard/i }).or(page.getByText('Active'))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders metric cards with session stats', async ({ page }) => {
    // Should show session count/stats cards
    await expect(page.getByText(/active/i)).toBeVisible({ timeout: 10_000 });
  });

  test('renders session table or session list', async ({ page }) => {
    // Should have session entries from mock data
    await expect(page.getByText('sess-mobile').or(page.getByText('Mobile dashboard pass'))).toBeVisible({
      timeout: 10_000,
    });
  });

  test('renders health indicator', async ({ page }) => {
    // Server health dot or status
    await expect(page.getByLabel(/server/i).or(page.getByText(/health|ok|connected/i))).toBeVisible({
      timeout: 10_000,
    });
  });

  test('navigates to session detail on session click', async ({ page }) => {
    const sessionLink = page.getByText('sess-mobile').or(page.getByText('Mobile dashboard pass')).first();
    await sessionLink.waitFor({ state: 'visible', timeout: 10_000 });
    await sessionLink.click();
    await expect(page).toHaveURL(/\/sessions\//, { timeout: 10_000 });
  });
});
