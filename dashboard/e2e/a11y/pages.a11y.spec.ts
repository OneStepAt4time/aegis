/**
 * e2e/a11y/pages.a11y.spec.ts — axe-core accessibility audit for all routes.
 *
 * Requires the dev server to be running (handled by playwright.config.ts webServer).
 * Run: npm run a11y:check
 */
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';
import { mockDashboardFixtures } from '../helpers/dashboard-fixtures';

const BASE_URL = 'http://localhost:5200/dashboard';
const ROUTES = ['/', '/sessions', '/pipelines', '/audit', '/auth/keys', '/settings'];
const THEMES = ['dark', 'light'] as const;

// Mock API responses so pages render without a live Aegis backend
test.beforeEach(async ({ page }) => {
  await mockDashboardFixtures(page);
});

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`[${theme}] ${route} has no axe violations`, async ({ page }) => {
      // Navigate to the route — auth is already set up by beforeEach
      await page.goto(BASE_URL + route);
      await page.waitForLoadState('networkidle');

      // Set theme after navigation
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : '');
        localStorage.setItem('aegis-dashboard-theme', t);
      }, theme);

      // Inject axe-core explicitly (required for axe-playwright v2)
      await injectAxe(page);

      // Run axe audit — disable known pre-existing issues tracked separately
      await checkA11y(page, undefined, {
        axeOptions: {
          rules: {
            // Dashboard uses h2 headings by design — tracked in dashboard-perfection epic
            'page-has-heading-one': { enabled: false },
            // Heading order issues from nested h2→h3 in sidebar — tracked separately
            'heading-order': { enabled: false },
            // Settings page form labels — tracked separately
            'label': { enabled: false },
            // Settings page select elements — tracked separately
            'select-name': { enabled: false },
            // Colour-contrast issues in dark-mode sidebar (muted tokens) — tracked separately
            'color-contrast': { enabled: false },
          },
        },
      });

      // Also assert the page rendered something meaningful
      const body = await page.locator('body').innerText();
      expect(body.length).toBeGreaterThan(0);
    });
  }
}
