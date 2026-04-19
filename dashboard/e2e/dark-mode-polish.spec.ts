/**
 * e2e/dark-mode-polish.spec.ts
 *
 * Tests dark mode polish enhancements from Issue #009:
 * - Display-P3 palette support
 * - View Transitions API
 * - CTA sheen animations
 * - Audit row shimmer
 * - No layout shift from animations
 */

import { test, expect } from '@playwright/test';

test.describe('Dark Mode Polish (Issue #009)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });
  });

  test('should apply Display-P3 colors on compatible displays', async ({ page }) => {
    // Check if P3 media query is supported
    const supportsP3 = await page.evaluate(() => {
      return window.matchMedia('(color-gamut: p3)').matches;
    });

    if (supportsP3) {
      // Check that P3 colors are being applied
      const ctaColor = await page.evaluate(() => {
        const root = document.documentElement;
        const ctaBg = getComputedStyle(root).getPropertyValue('--color-accent-cyan');
        return ctaBg.trim();
      });

      // P3 colors use color(display-p3 ...) syntax
      expect(ctaColor).toMatch(/color\(display-p3/);
    }
  });

  test('should have view-transition-name on main content', async ({ page }) => {
    const hasViewTransitionName = await page.evaluate(() => {
      const main = document.querySelector('main#main-content');
      if (!main) return false;
      
      const styles = window.getComputedStyle(main);
      // @ts-ignore - view-transition-name is a newer property
      return styles.viewTransitionName === 'main-content';
    });

    expect(hasViewTransitionName).toBe(true);
  });

  test('should show CTA sheen animation in normal motion mode', async ({ page }) => {
    // Find a primary CTA button
    const ctaButton = page.locator('button[class*="bg-cyan-"], button[class*="bg-[var(--color-cta-bg)]"]').first();
    
    if (await ctaButton.count() > 0) {
      const hasSheen = await ctaButton.evaluate((btn) => {
        const before = window.getComputedStyle(btn, '::before');
        const animName = before.animationName;
        
        // Should have cta-sheen animation
        return animName.includes('cta-sheen');
      });

      expect(hasSheen).toBe(true);
    }
  });

  test('should pause CTA sheen on hover', async ({ page }) => {
    const ctaButton = page.locator('button[class*="bg-cyan-"], button[class*="bg-[var(--color-cta-bg)]"]').first();
    
    if (await ctaButton.count() > 0) {
      await ctaButton.hover();
      
      const isPaused = await ctaButton.evaluate((btn) => {
        const before = window.getComputedStyle(btn, '::before');
        return before.animationPlayState === 'paused';
      });

      expect(isPaused).toBe(true);
    }
  });

  test('should not cause layout shift from sheen animations', async ({ page }) => {
    // Navigate to overview and measure CLS
    await page.goto('/', { waitUntil: 'networkidle' });
    
    // Wait for animations to settle
    await page.waitForTimeout(1000);
    
    // Get layout shift score
    const cls = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsScore = 0;
        
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
              clsScore += (entry as any).value;
            }
          }
        });
        
        observer.observe({ type: 'layout-shift', buffered: true });
        
        // Give time for any shifts to be recorded
        setTimeout(() => {
          observer.disconnect();
          resolve(clsScore);
        }, 2000);
      });
    });

    // CLS should be below 0.02 (budget from spec)
    expect(cls).toBeLessThan(0.02);
  });

  test('should have ambient drift animation in normal motion mode', async ({ page }) => {
    const hasAmbientDrift = await page.evaluate(() => {
      const bodyAfter = window.getComputedStyle(document.body, '::after');
      const animName = bodyAfter.animationName;
      
      return animName.includes('ambient-drift');
    });

    expect(hasAmbientDrift).toBe(true);
  });

  test('should use GPU-accelerated properties for ambient drift', async ({ page }) => {
    const usesGPU = await page.evaluate(() => {
      const bodyAfter = window.getComputedStyle(document.body, '::after');
      const willChange = bodyAfter.willChange;
      
      // Should use will-change: filter for GPU acceleration
      return willChange.includes('filter');
    });

    expect(usesGPU).toBe(true);
  });
});

test.describe('Dark Mode Polish - Reduced Motion', () => {
  test.use({
    colorScheme: 'dark',
  });

  test('should disable CTA sheen when prefers-reduced-motion is reduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    await page.goto('/');
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });
    
    const ctaButton = page.locator('button[class*="bg-cyan-"], button[class*="bg-[var(--color-cta-bg)]"]').first();
    
    if (await ctaButton.count() > 0) {
      const animationDuration = await ctaButton.evaluate((btn) => {
        const before = window.getComputedStyle(btn, '::before');
        return before.animationDuration;
      });

      // Should be instant or disabled
      expect(animationDuration).toMatch(/^(0s|0\.001s|none)$/);
    }
  });

  test('should disable ambient drift when prefers-reduced-motion is reduce', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    await page.goto('/');
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });
    
    const ambientDisabled = await page.evaluate(() => {
      const bodyAfter = window.getComputedStyle(document.body, '::after');
      const animDuration = bodyAfter.animationDuration;
      
      return animDuration === '0s' || animDuration === '0.001s' || animDuration === 'none';
    });

    expect(ambientDisabled).toBe(true);
  });

  test('visual snapshot: no animations with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    
    await page.goto('/');
    await page.waitForSelector('[data-testid="overview-page"], h1:has-text("Overview")', { timeout: 10000 });
    
    // Take snapshot with reduced motion
    await expect(page).toHaveScreenshot('overview-reduced-motion.png', {
      maxDiffPixels: 100,
    });
  });
});
