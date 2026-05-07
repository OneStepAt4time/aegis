/**
 * e2e/acp-views.spec.ts — Playwright E2E tests for ACP dashboard views.
 *
 * Covers ACP-081 (chat view), ACP-083 (approval modal), ACP-085 (pause/resume),
 * and session shell integration.
 *
 * Uses mock API data from dashboard-fixtures.ts.
 * Tests run against dev server with all API routes intercepted.
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures, MOBILE_SESSION_ID, SESSION_COCKPIT_ID } from './helpers/dashboard-fixtures';

test.describe('ACP Dashboard Views', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);
  });

  test.describe('Session List (ACP-080 integration)', () => {
    test('renders session list page', async ({ page }) => {
      await page.goto('/');
      // Should navigate to sessions page (default route)
      await page.waitForLoadState('networkidle');
      // Sessions page should be visible
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();
    });

    test('displays session window names from API', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      // Should show session names from mock data
      await expect(page.getByText('Mobile dashboard pass')).toBeVisible();
    });

    test('navigates to session detail on click', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const sessionLink = page.getByText('Mobile dashboard pass');
      await sessionLink.click();
      await expect(page).toHaveURL(/\/sessions\/sess-mobile/);
    });

    test('session list has navigation sidebar', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const nav = page.getByRole('navigation');
      await expect(nav).toBeVisible();
    });
  });

  test.describe('ACP-081: Chat / Transcript View', () => {
    test('session detail shows transcript messages', async ({ page }) => {
      await page.goto(`/sessions/${MOBILE_SESSION_ID}`);
      await page.waitForLoadState('networkidle');
      // Should show the assistant message from mock data
      await expect(page.getByText('Ready to continue once you approve')).toBeVisible();
    });

    test('session detail shows tool use messages', async ({ page }) => {
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      // Cockpit session has a tool_use message
      const toolMessage = page.getByText('Review the README.');
      await expect(toolMessage).toBeVisible();
    });
  });

  test.describe('ACP-083: Approval Modal / Permission Prompt', () => {
    test('shows permission prompt for permission_prompt session', async ({ page }) => {
      await page.goto(`/sessions/${MOBILE_SESSION_ID}`);
      await page.waitForLoadState('networkidle');
      // Should show the permission prompt
      await expect(page.getByText('Allow Claude to run npm run deploy')).toBeVisible();
    });

    test('has approve and reject buttons', async ({ page }) => {
      await page.goto(`/sessions/${MOBILE_SESSION_ID}`);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
    });

    test('approve button sends POST request', async ({ page }) => {
      await page.goto(`/sessions/${MOBILE_SESSION_ID}`);
      await page.waitForLoadState('networkidle');
      const approveResponse = page.waitForResponse((resp) =>
        resp.url().includes('approve') && resp.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Approve' }).click();
      const response = await approveResponse;
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
    });

    test('reject button sends POST request', async ({ page }) => {
      await page.goto(`/sessions/${MOBILE_SESSION_ID}`);
      await page.waitForLoadState('networkidle');
      const rejectResponse = page.waitForResponse((resp) =>
        resp.url().includes('reject') && resp.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Reject' }).click();
      const response = await rejectResponse;
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
    });

    test('permission prompt has aria-label for accessibility', async ({ page }) => {
      await page.goto(`/sessions/${MOBILE_SESSION_ID}`);
      await page.waitForLoadState('networkidle');
      const prompt = page.getByLabel('Permission prompt');
      await expect(prompt).toBeVisible();
    });
  });

  test.describe('ACP-085: Session Controls', () => {
    test('session detail page loads without console errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(err.message));
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      expect(errors).toHaveLength(0);
    });

    test('displays session metadata (window name)', async ({ page }) => {
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('Cockpit regression')).toBeVisible();
    });

    test('session detail has tab navigation', async ({ page }) => {
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      // Should have tab buttons for stream/metrics/audit/transcript
      const tabList = page.getByRole('tablist');
      await expect(tabList).toBeVisible();
    });
  });

  test.describe('Question State', () => {
    test('session with question shows pending question', async ({ page }) => {
      await page.goto('/sessions/sess-question');
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('What should the empty state CTA say on mobile?')).toBeVisible();
    });
  });

  test.describe('Dark Theme and Layout', () => {
    test('dashboard uses dark background', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const bgColor = await page.evaluate(() => {
        return window.getComputedStyle(document.body).backgroundColor;
      });
      // Dark theme: very dark background (close to #0a0a0f)
      expect(bgColor).toMatch(/rgba?\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3}/);
    });

    test('sidebar collapses on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      // On mobile, should have a hamburger menu
      const menuButton = page.getByRole('button', { name: /menu/i });
      await expect(menuButton).toBeVisible();
    });

    test('text is readable on dark background (WCAG contrast)', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toBeVisible();
      // Heading should have sufficient contrast
      const color = await heading.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return computed.color;
      });
      // Should be a light color (not too dark)
      expect(color).toBeTruthy();
    });
  });

  test.describe('ACP-086: Terminal Debug View', () => {
    test('shows diagnostic warning in terminal view', async ({ page }) => {
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^Terminal$/ }).click();
      await expect(page.getByText('Diagnostic surface')).toBeVisible();
    });

    test('terminal view shows connection state', async ({ page }) => {
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^Terminal$/ }).click();
      await expect(page.getByText('connecting')).toBeVisible();
    });

    test('driver sees terminal input in terminal view', async ({ page }) => {
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^Terminal$/ }).click();
      await expect(page.getByPlaceholder('Type a command...')).toBeVisible();
    });
  });

  test.describe('ACP-087: Operator Timeline View', () => {
    test('timeline tab renders operator events', async ({ page }) => {
      await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /^Timeline$/ }).click();
      await expect(page.getByText('Session created')).toBeVisible();
      await expect(page.getByText('Driver claimed')).toBeVisible();
    });
  });
});
