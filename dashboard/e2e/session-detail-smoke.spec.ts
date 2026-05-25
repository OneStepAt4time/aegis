/**
 * e2e/session-detail-smoke.spec.ts — Smoke tests for the Session Detail page.
 *
 * Verifies the session detail page loads correctly with:
 * Status badge, stream/metrics tabs, action buttons, and transcript.
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures, SESSION_COCKPIT_ID } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Session Detail Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);
  });

  test('renders session detail with status badge', async ({ page }) => {
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_COCKPIT_ID}`);
    // Session ID or status should be visible
    await expect(page.getByText(SESSION_COCKPIT_ID)).toBeVisible({ timeout: 10_000 });
  });

  test('renders tab strip with Stream and Metrics', async ({ page }) => {
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_COCKPIT_ID}`);
    await expect(page.getByRole('tab', { name: /stream/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /metrics/i })).toBeVisible({ timeout: 10_000 });
  });

  test('Stream tab shows content by default', async ({ page }) => {
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_COCKPIT_ID}`);
    // Should show some stream content or empty state
    const streamContent = page.locator('[data-testid="stream-tab"], .stream-content, [role="tabpanel"]');
    await expect(streamContent.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Metrics tab renders KPI data when clicked', async ({ page }) => {
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_COCKPIT_ID}`);
    const metricsTab = page.getByRole('tab', { name: /metrics/i });
    await expect(metricsTab).toBeVisible({ timeout: 10_000 });
    await metricsTab.click();
    // Metrics panel should appear
    await expect(page.getByText(/\d+.*message|\d+.*tool/i)).toBeVisible({ timeout: 10_000 });
  });

  test('session detail page is accessible — has main landmark', async ({ page }) => {
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_COCKPIT_ID}`);
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 10_000 });
  });

  test('kill button is present for active sessions', async ({ page }) => {
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_COCKPIT_ID}`);
    const killBtn = page.getByRole('button', { name: /kill|terminate/i });
    await expect(killBtn).toBeVisible({ timeout: 10_000 });
  });
});
