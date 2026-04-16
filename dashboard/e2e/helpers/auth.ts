import type { Page } from '@playwright/test';

/**
 * Authenticate the dashboard by injecting a token and mocking the verify endpoint.
 * Required before navigating to protected pages in smoke tests.
 */
export async function authenticate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('aegis_token', 'e2e-test-token');
  });

  await page.route('**/v1/auth/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: true, role: 'admin' }),
    });
  });
}
