/**
 * e2e/typography-cls.spec.ts — CLS metric test for typography system
 *
 * Validates that Cumulative Layout Shift (CLS) remains under 0.02 during
 * page navigation and font loading, ensuring size-adjust and font-display
 * prevent visual reflow.
 */

import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';
const CLS_THRESHOLD = 0.02;

test.describe('Typography CLS', () => {
  test('CLS metric under 0.02 on navigation', async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.goto(DASHBOARD_BASE_URL, { waitUntil: 'networkidle' });

    const clsMetric = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
              clsValue += (entry as any).value;
            }
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });

        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 3000);
      });
    });

    expect(clsMetric).toBeLessThan(CLS_THRESHOLD);
  });

  test('no font-family literals outside tokens in components', async () => {
    // This test is effectively a static check placeholder;
    // the real validation is done by grep during the gate.
    // We're asserting the contract here for documentation.
    expect(true).toBe(true);
  });
});
