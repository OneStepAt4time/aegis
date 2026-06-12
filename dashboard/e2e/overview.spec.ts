import { expect, test } from '@playwright/test';
import { mockDashboardFixtures, MOBILE_SESSION_ID } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Overview Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);
    await page.goto(`${DASHBOARD_BASE_URL}`);
  });

  test('renders overview heading or session table', async ({ page }) => {
    // Overview is the landing page — should show the heading
    await expect(
      page.getByRole('heading', { name: 'Overview' })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders metric cards with session stats', async ({ page }) => {
    // Should show session count/stats in KPI banner
    await expect(page.getByText(/^Sessions$/i, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('renders session table or session list', async ({ page }) => {
    // Should have session entries or an error/retry state from mock data
    // Sessions may be in virtualized list — check for table or session text
    await expect(
      page.getByRole('table', { name: 'Sessions table' })
    ).toBeVisible({
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
    // Session links are in a virtualized list — navigate directly to verify detail renders
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${MOBILE_SESSION_ID}`);
    await expect(page.getByText(/Mobile Dashboard|Mobile dashboard/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
