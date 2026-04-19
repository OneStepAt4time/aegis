/**
 * e2e/i18n-rtl.spec.ts — RTL and locale tests for i18n plumbing.
 * Tests logical properties and date/number formatting.
 */

import { test, expect } from '@playwright/test';

test.describe('I18n RTL support', () => {
  test('should render correctly with dir="rtl"', async ({ page }) => {
    await page.goto('/');
    
    // Set RTL direction
    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
    });
    
    // Wait for page to render
    await page.waitForLoadState('networkidle');
    
    // Take screenshot of key pages in RTL mode
    await expect(page).toHaveScreenshot('overview-rtl.png', {
      fullPage: false,
      maxDiffPixels: 100,
    });
    
    // Navigate to sessions page
    await page.click('a[href*="sessions"]');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveScreenshot('sessions-rtl.png', {
      fullPage: false,
      maxDiffPixels: 100,
    });
  });
  
  test('should use logical properties (not fail in RTL)', async ({ page }) => {
    await page.goto('/');
    
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
    await page.goto('/');
    await page.click('a[href*="settings"]');
    
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
    await page.goto('/');
    await page.click('a[href*="settings"]');
    
    // Change locale
    await page.selectOption('select', 'de-DE');
    
    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Check that locale is still selected
    const selected = await page.locator('select').inputValue();
    expect(selected).toBe('de-DE');
  });
});
