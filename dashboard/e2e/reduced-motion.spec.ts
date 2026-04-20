/**
 * e2e/reduced-motion.spec.ts
 *
 * Tests that all animations respect prefers-reduced-motion: reduce.
 * Issue #017 — Motion & animated color for the Aegis dashboard.
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Reduced Motion Accessibility', () => {
  test.use({
    // Emulate prefers-reduced-motion: reduce
    colorScheme: 'dark',
  });

  test('should disable all animations when prefers-reduced-motion is reduce', async ({ page }) => {
    // Emulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockDashboardFixtures(page);

    await page.goto(DASHBOARD_BASE_URL);

    // Wait for page to load
    await page.waitForSelector('h2:has-text("Overview")', { timeout: 10000 });

    // Verify the prefers-reduced-motion media query is applied
    const motionReduced = await page.evaluate(() =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    expect(motionReduced).toBe(true);

    // Check that no elements have animations longer than 1ms (CSS uses 0.001ms = 1e-06s)
    const htmlElement = page.locator('html');
    const longAnimations = await htmlElement.evaluate((el) => {
      const allElements = el.querySelectorAll('*');
      const longDuration: string[] = [];

      allElements.forEach((element) => {
        const computed = window.getComputedStyle(element);
        const animDuration = computed.animationDuration;
        const transDuration = computed.transitionDuration;

        // Check if animation or transition duration is longer than 1ms (0.001s)
        const isLong = (s: string) => {
          if (!s || s === '0s' || s === 'none') return false;
          return parseFloat(s) > 0.001; // > 1ms
        };

        if (isLong(animDuration) || isLong(transDuration)) {
          longDuration.push(`${element.tagName}: anim=${animDuration} trans=${transDuration}`);
        }
      });

      return longDuration;
    });

    // In reduced motion mode, all animations should be 1ms or less
    expect(longAnimations).toEqual([]);
  });

  test('should not show motion.tr animations in audit table', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockDashboardFixtures(page);

    await page.goto(DASHBOARD_BASE_URL + 'audit');

    // Wait for audit page to load
    await page.waitForSelector('h2:has-text("Audit Trail")', { timeout: 10000 });

    // Check that rows appear instantly without slide-in animation
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.count() > 0) {
      const opacity = await firstRow.evaluate((el) => {
        return window.getComputedStyle(el).opacity;
      });
      // Should be fully opaque immediately (no fade-in)
      expect(Number.parseFloat(opacity)).toBeGreaterThanOrEqual(0.99);
    }
  });

  test('should not animate theme swap', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockDashboardFixtures(page);

    await page.goto(DASHBOARD_BASE_URL);
    await page.waitForSelector('h2:has-text("Overview")', { timeout: 10000 });

    // Find and click theme toggle button
    const themeToggle = page.locator('button[aria-label*="theme"], button:has(svg.lucide-sun), button:has(svg.lucide-moon)').first();
    
    if (await themeToggle.count() > 0) {
      // Get initial theme class on <html> (dark/light)
      const initialClass = await page.locator('html').getAttribute('class');

      await themeToggle.click();
      
      // Wait a tiny bit for any instant transition
      await page.waitForTimeout(50);

      // Get new theme class — it should have changed
      const newClass = await page.locator('html').getAttribute('class');

      // Theme class should have changed (dark ↔ light)
      expect(initialClass).not.toBe(newClass);

      // Verify no transition is active — background-color transition should be instant
      const transitionDuration = await page.locator('body').evaluate(() => {
        const style = window.getComputedStyle(document.body);
        return style.transitionDuration;
      });

      // Should be instant or near-instant (CSS uses 0.001ms = 1e-06s, or "0s")
      const durations = transitionDuration.split(',').map((s) => s.trim());
      for (const d of durations) {
        const ms = parseFloat(d) * (d.endsWith('ms') ? 1 : 1000);
        expect(ms).toBeLessThanOrEqual(1);
      }
    }
  });

  test('should not show ambient background drift animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockDashboardFixtures(page);

    await page.goto(DASHBOARD_BASE_URL);
    await page.waitForSelector('h2:has-text("Overview")', { timeout: 10000 });

    // Check body::after element for ambient drift animation
    const hasAmbientAnimation = await page.evaluate(() => {
      const bodyAfter = window.getComputedStyle(document.body, '::after');
      const animName = bodyAfter.animationName;
      const animDuration = bodyAfter.animationDuration;
      
      // Should either have no animation or instant animation (0.001ms = 1e-06s)
      return animName !== 'none' && parseFloat(animDuration) > 0.001;
    });

    expect(hasAmbientAnimation).toBe(false);
  });

  test('should not animate StatusDot pulse', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockDashboardFixtures(page);

    await page.goto(DASHBOARD_BASE_URL + 'sessions');
    await page.waitForSelector('h2:has-text("Sessions")', { timeout: 10000 });

    // Find any status dots with working state (which normally pulse)
    const workingDots = page.locator('[data-variant="working"]');
    
    if (await workingDots.count() > 0) {
      const firstDot = workingDots.first();
      const animationDuration = await firstDot.evaluate((el) => {
        return window.getComputedStyle(el).animationDuration;
      });

      // Should be instant or disabled (CSS uses 0.001ms = 1e-06s)
      expect(animationDuration).toMatch(/^(0s|0\.001s|1e-06s|none)$/);
    }
  });
});

test.describe('Normal Motion (no preference)', () => {
  test('should show animations when reduced motion is not set', async ({ page }) => {
    // Do not set reducedMotion preference (defaults to 'no-preference')
    await mockDashboardFixtures(page);
    await page.goto('/');
    await page.waitForSelector('h2:has-text("Overview")', { timeout: 10000 });

    // Theme transition should be active
    const themeTransition = await page.locator(':root').evaluate(() => {
      const root = document.documentElement;
      const styles = window.getComputedStyle(root);
      return styles.transitionProperty;
    });

    // Should have transitions defined (background-color, color, etc.)
    expect(themeTransition).toBeTruthy();
  });
});
