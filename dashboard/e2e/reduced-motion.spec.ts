/**
 * e2e/reduced-motion.spec.ts
 *
 * Tests that all animations respect prefers-reduced-motion: reduce.
 * Issue #017 — Motion & animated color for the Aegis dashboard.
 */

import { test, expect } from '@playwright/test';

test.describe('Reduced Motion Accessibility', () => {
  test.use({
    // Emulate prefers-reduced-motion: reduce
    colorScheme: 'dark',
  });

  test('should disable all animations when prefers-reduced-motion is reduce', async ({ page }) => {
    // Emulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/');

    // Wait for page to load
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });

    // Check that the reduced motion CSS is applied
    const htmlElement = page.locator('html');
    const animations = await htmlElement.evaluate((el) => {
      const allElements = el.querySelectorAll('*');
      const animatedElements: Array<{
        tag: string;
        animationDuration: string;
        transitionDuration: string;
      }> = [];

      allElements.forEach((element) => {
        const computed = window.getComputedStyle(element);
        const animDuration = computed.animationDuration;
        const transDuration = computed.transitionDuration;

        // Check if animation or transition duration is longer than 1ms
        if (
          (animDuration && animDuration !== '0s' && animDuration !== '0.001s') ||
          (transDuration && transDuration !== '0s' && transDuration !== '0.001s')
        ) {
          animatedElements.push({
            tag: element.tagName,
            animationDuration: animDuration,
            transitionDuration: transDuration,
          });
        }
      });

      return animatedElements;
    });

    // In reduced motion mode, all animations should be instant (0.001s or less)
    expect(animations.length).toBe(0);
  });

  test('should not show motion.tr animations in audit table', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/audit');

    // Wait for audit page to load
    await page.waitForSelector('h1:has-text("Audit Trail")', { timeout: 10000 });

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

    await page.goto('/');
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });

    // Find and click theme toggle button
    const themeToggle = page.locator('button[aria-label*="theme"], button:has(svg.lucide-sun), button:has(svg.lucide-moon)').first();
    
    if (await themeToggle.count() > 0) {
      // Get initial background color
      const initialBg = await page.locator('html').evaluate((el) => 
        window.getComputedStyle(el).backgroundColor
      );

      await themeToggle.click();
      
      // Wait a tiny bit for any instant transition
      await page.waitForTimeout(50);

      // Get new background color
      const newBg = await page.locator('html').evaluate((el) => 
        window.getComputedStyle(el).backgroundColor
      );

      // Colors should be different (theme changed) but transition should be instant
      expect(initialBg).not.toBe(newBg);

      // Verify no transition is active
      const transitionDuration = await page.locator('html').evaluate((el) => {
        const root = document.querySelector(':root');
        if (!root) return '0s';
        return window.getComputedStyle(root).transitionDuration;
      });

      // Should be instant or near-instant
      expect(transitionDuration).toMatch(/^(0s|0\.001s)$/);
    }
  });

  test('should not show ambient background drift animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/');
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });

    // Check body::after element for ambient drift animation
    const hasAmbientAnimation = await page.evaluate(() => {
      const bodyAfter = window.getComputedStyle(document.body, '::after');
      const animName = bodyAfter.animationName;
      const animDuration = bodyAfter.animationDuration;
      
      // Should either have no animation or instant animation
      return animName !== 'none' && animDuration !== '0s' && animDuration !== '0.001s';
    });

    expect(hasAmbientAnimation).toBe(false);
  });

  test('should not animate StatusDot pulse', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.goto('/sessions');
    await page.waitForSelector('[data-testid="sessions-page"], h1:has-text("Sessions")', { timeout: 10000 });

    // Find any status dots with working state (which normally pulse)
    const workingDots = page.locator('[data-variant="working"]');
    
    if (await workingDots.count() > 0) {
      const firstDot = workingDots.first();
      const animationDuration = await firstDot.evaluate((el) => {
        return window.getComputedStyle(el).animationDuration;
      });

      // Should be instant or disabled
      expect(animationDuration).toMatch(/^(0s|0\.001s|none)$/);
    }
  });
});

test.describe('Normal Motion (no preference)', () => {
  test('should show animations when reduced motion is not set', async ({ page }) => {
    // Do not set reducedMotion preference (defaults to 'no-preference')
    
    await page.goto('/');
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });

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
