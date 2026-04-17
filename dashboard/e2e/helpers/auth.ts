import type { Page } from '@playwright/test';

const DASHBOARD_LOGIN_URL = 'http://localhost:5173/dashboard/login';
const TEST_TOKEN = 'e2e-test-token';

/**
 * Authenticate the dashboard through the current memory-only token flow.
 * Required before navigating to protected pages in smoke tests.
 */
export async function authenticate(page: Page): Promise<void> {
  await page.route('**/v1/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, role: 'admin' }),
    });
  });

  await page.goto(DASHBOARD_LOGIN_URL);
  await page.getByLabel(/api token/i).fill(TEST_TOKEN);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard\/?$/);
}
