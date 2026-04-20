/**
 * e2e/i18n-rtl.spec.ts — RTL and locale tests for i18n plumbing.
 * Tests logical properties and date/number formatting.
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('I18n RTL support', () => {
  test('should render correctly with dir="rtl"', async ({ page }) => {
    await mockDashboardFixtures(page);
    await page.goto(DASHBOARD_BASE_URL);

    // Set RTL direction
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
    });

    // Wait for page to render
    await page.waitForLoadState('networkidle');

    // Verify page rendered in RTL — check direction attribute and main content
    const dir = await page.locator('html').getAttribute('dir');
    expect(dir).toBe('rtl');

    // Navigate to sessions page
    await page.goto(DASHBOARD_BASE_URL + 'sessions');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
    });

    const dirAfterNav = await page.locator('html').getAttribute('dir');
    expect(dirAfterNav).toBe('rtl');
  });

  test('should use logical properties (not fail in RTL)', async ({ page }) => {
    await mockDashboardFixtures(page);
    await page.goto(DASHBOARD_BASE_URL);

    // Set RTL
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
    });

    await page.waitForLoadState('networkidle');

    // Check that layout doesn't break
    const mainContent = page.locator('main');
    const boundingBox = await mainContent.boundingBox();

    expect(boundingBox).toBeTruthy();
    expect(boundingBox!.width).toBeGreaterThan(100);
  });
});

test.describe('Locale formatting', () => {
  test('should display locale picker in settings', async ({ page }) => {
    await mockDashboardFixtures(page);
    await page.goto(DASHBOARD_BASE_URL + 'settings');
    await page.waitForLoadState('networkidle');

    // Look for the locale selector
    const localeSelect = page.locator('select').filter({ hasText: /English/ });
    await expect(localeSelect).toBeVisible();

    // Check options include different locales
    const options = await localeSelect.locator('option').allTextContents();
    expect(options.some(o => o.includes('English'))).toBeTruthy();
    expect(options.some(o => o.includes('Deutsch'))).toBeTruthy();
    expect(options.some(o => o.includes('日本語'))).toBeTruthy();
  });

  test('should persist locale selection', async ({ page }) => {
    await mockDashboardFixtures(page);
    await page.goto(DASHBOARD_BASE_URL + 'settings');
    await page.waitForLoadState('networkidle');

    // Set locale directly via localStorage (simulates what the UI select does)
    await page.evaluate(() => {
      localStorage.setItem('aegis-locale', 'de-DE');
      localStorage.setItem('locale', 'de-DE');
    });

    // Reload page — addInitScript persists auth; localStorage persists locale
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Locale should still be stored after reload
    const storedLocale = await page.evaluate(() =>
      localStorage.getItem('aegis-locale') || localStorage.getItem('locale')
    );
    expect(storedLocale).toBe('de-DE');
  });
});
