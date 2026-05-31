import { test, expect } from '@playwright/test';
import { mockOidcUnavailable } from './helpers/auth';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockOidcUnavailable(page);
    await page.route('**/v1/auth/sse-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'e2e-sse-token', expiresAt: Date.now() + 60_000 }),
      });
    });
    await page.route('**/v1/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', version: '0.0.0' }),
      });
    });
    await page.route('**/v1/events', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [] }),
      });
    });
    await page.route('**/v1/sessions/stats', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 0, totalCreated: 0, totalCompleted: 0, totalFailed: 0, byStatus: {} }),
      });
    });
    await page.route('**/v1/analytics/summary', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active_agents: 0, metrics: {}, prompt_delivery: { sent: 0, delivered: 0, failed: 0, success_rate: 0 } }),
      });
    });
    await page.route(/\/v1\/sessions(\?.*)?$/, async (route) => {
      if (!route.request().headers().authorization) {
        await route.abort('failed');
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [], pagination: { page: 1, limit: 1, total: 0, totalPages: 1 } }),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem('aegis:onboarded', 'true');
      localStorage.setItem('aegis:tour:completed', '1');
    });
    await page.goto(`${DASHBOARD_BASE_URL}/login`);
  });

  test('renders login form with branding', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Aegis' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Enter your API token to continue')).toBeVisible();
    await expect(page.locator('svg.lucide-shield')).toBeVisible();
  });

  test('renders token input and sign-in button', async ({ page }) => {
    const input = page.getByLabel(/api token/i);
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('type', 'password');

    const submitBtn = page.getByRole('button', { name: /sign in/i });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  test('show/hide token toggle works', async ({ page }) => {
    const input = page.getByLabel(/api token/i);
    await input.fill('my-secret-token');
    await expect(input).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: /show token/i }).click();
    await expect(input).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: /hide token/i }).click();
    await expect(input).toHaveAttribute('type', 'password');
  });

  test('sign-in button enables when token is entered', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: /sign in/i });
    await expect(submitBtn).toBeDisabled();

    await page.getByLabel(/api token/i).fill('some-token');
    await expect(submitBtn).toBeEnabled();
  });

  test('displays error on invalid token', async ({ page }) => {
    await page.route('**/v1/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: false }),
      });
    });

    await page.getByLabel(/api token/i).fill('bad-token');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText('Invalid API token')).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/login/);
  });

  test('redirects to overview on successful login', async ({ page }) => {
    await page.route('**/v1/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true, role: 'admin' }),
      });
    });

    await page.getByLabel(/api token/i).fill('valid-token');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should navigate away from login
    await expect(page).not.toHaveURL(/login/, { timeout: 5_000 });
  });

  test('shows loading state while verifying', async ({ page }) => {
    // Delay the verify response
    await page.route('**/v1/auth/verify', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: false }),
      });
    });

    await page.getByLabel(/api token/i).fill('some-token');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('button', { name: /verifying/i })).toBeVisible({ timeout: 1_000 });
  });

  test('no unexpected console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.getByLabel(/api token/i).fill('test');
    await page.getByRole('button', { name: /show token/i }).click();

    // Filter out network-related errors (expected when API server isn't running)
    const unexpectedErrors = errors.filter(
      (e) => !e.includes('Failed to fetch') && !e.includes('net::ERR'),
    );
    expect(unexpectedErrors).toEqual([]);
  });
});
