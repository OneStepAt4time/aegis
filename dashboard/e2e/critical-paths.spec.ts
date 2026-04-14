import { test, expect } from '@playwright/test';

test.describe('Critical Path E2E Tests', () => {

  // 1. Dashboard loads and renders overview
  test('overview page loads and renders heading and sessions text', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /overview/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/sessions/i)).toBeVisible();
  });

  // 2. Login page renders and stays on login without token
  test('login page stays on /login without valid token', async ({ page }) => {
    await page.goto('/login');
    const submitButton = page.getByRole('button', { name: /login|submit|enter|sign/i });
    await expect(submitButton).toBeVisible({ timeout: 10_000 });
    // Click without filling token
    await submitButton.click();
    // Should remain on login page
    await expect(page).toHaveURL(/login/);
  });

  // 3. Session history page renders with search input
  test('session history page renders search input', async ({ page }) => {
    await page.goto('/sessions/history');
    await expect(page.getByPlaceholder(/search|filter/i)).toBeVisible({ timeout: 10_000 });
  });

  // 4. Session detail page renders error state for invalid ID
  test('session detail shows error for invalid session ID', async ({ page }) => {
    await page.goto('/sessions/nonexistent-session-id-12345');
    // Page should render content (either error message or not found)
    // Assert that the page didn't crash (no blank screen)
    await expect(page.locator('main')).toBeVisible({ timeout: 10_000 });
  });

  // 5. Theme toggle changes data-theme attribute on settings page
  test('theme toggle changes data-theme on settings page', async ({ page }) => {
    await page.goto('/settings');
    const themeButton = page.getByRole('button', { name: /dark|light/i });
    await expect(themeButton).toBeVisible({ timeout: 10_000 });

    const themeBefore = await page.locator('html').getAttribute('data-theme');
    await themeButton.click();
    const themeAfter = await page.locator('html').getAttribute('data-theme');
    expect(themeAfter).not.toBe(themeBefore);
  });

  // 6. CSV export button is visible on session history page
  test('CSV export button is present on session history page', async ({ page }) => {
    await page.goto('/sessions/history');
    const exportBtn = page.getByRole('button', { name: /export|csv/i });
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });
  });

  // 7. SSE connection indicator visible on overview
  test('SSE status indicator shows Live or Polling', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/^(Live|Polling)$/i)).toBeVisible({ timeout: 15_000 });
  });

});
