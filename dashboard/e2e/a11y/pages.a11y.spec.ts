/**
 * e2e/a11y/pages.a11y.spec.ts — axe-core accessibility audit for all routes.
 *
 * Requires the dev server to be running (handled by playwright.config.ts webServer).
 * Run: npm run a11y:check
 */
import { test, expect } from '@playwright/test';
import { auditPage } from './axe.setup';

const ROUTES = ['/', '/sessions', '/pipelines', '/audit', '/auth/keys', '/settings'];
const THEMES = ['dark', 'light'] as const;

// Mock API responses so pages render without a live Aegis backend
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', version: '0.0.0-test', uptime: 0, sessions: { active: 0, total: 0 }, timestamp: new Date().toISOString() }),
    }),
  );
  await page.route('**/v1/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  );
  await page.route('**/v1/pipelines**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pipelines: [] }) }),
  );
  await page.route('**/v1/audit**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [], total: 0, pagination: { hasMore: false } }) }),
  );
  await page.route('**/v1/auth/keys**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ keys: [] }) }),
  );
  await page.route('**/v1/sessions/history**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ records: [], pagination: { total: 0, hasMore: false } }) }),
  );
  await page.route('**/v1/updates**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ currentVersion: '0.0.0-test', latestVersion: '0.0.0-test', updateAvailable: false }) }),
  );
});

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`[${theme}] ${route} has no axe violations`, async ({ page }) => {
      // Navigate to the login page first to set up auth state
      await page.goto('/');

      // Set theme before navigation
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : '');
        localStorage.setItem('aegis-dashboard-theme', t);
      }, theme);

      // Navigate to target route
      await page.goto(route);
      await page.waitForLoadState('networkidle');

      // Run axe audit — exclude known third-party elements
      await auditPage(page, {
        axeOptions: {
          rules: {
            // Colour-contrast for the terminal (xterm.js) is checked separately
            'color-contrast': { enabled: true },
          },
        },
      });

      // Also assert the page rendered something meaningful
      const body = await page.locator('body').innerText();
      expect(body.length).toBeGreaterThan(0);
    });
  }
}
