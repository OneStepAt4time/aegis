/**
 * e2e/a11y/pages.a11y.spec.ts — axe-core accessibility audit for all routes.
 *
 * Requires the dev server to be running (handled by playwright.config.ts webServer).
 * Run: npm run a11y:check
 */
import { test, expect } from '@playwright/test';
import { injectAxe, getViolations } from 'axe-playwright';
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
      test.setTimeout(60_000);
      // Navigate to the route — auth is already set up by beforeEach
      await page.goto(BASE_URL + route);
      await expect(page.locator('main#main-content')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('main#main-content h1')).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState('networkidle');

      // Set theme after navigation
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
        document.documentElement.classList.toggle('dark', t === 'dark');
        localStorage.setItem('aegis-dashboard-theme', t);
      }, theme);

      // Inject axe-core explicitly (required for axe-playwright v2)
      await injectAxe(page);

      // Run axe audit — disable known pre-existing heading-order noise while
      // enforcing the route-level rules fixed by the dashboard audit patch.
      const violations = await getViolations(page, undefined, {
        rules: {
          // Heading order issues from nested h2→h3 in sidebar — tracked separately
          'heading-order': { enabled: false },
          // Axe miscomputes contrast over glass/backdrop surfaces; token gates
          // and targeted CSS shims cover the concrete contrast regressions.
          'color-contrast': { enabled: false },
        },
      });
      const summary = violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
        })),
      }));
      expect(summary).toEqual([]);

      // Also assert the page rendered something meaningful
      const body = await page.locator('body').innerText();
      expect(body.length).toBeGreaterThan(0);
    });
  }
}
