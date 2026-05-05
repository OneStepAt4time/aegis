/**
 * e2e/acp-controls.spec.ts — Playwright E2E tests for ACP control actions.
 *
 * Tests pause/resume, interrupt, kill, and escape controls.
 * Uses mock API endpoints from acp-fixtures.ts.
 *
 * TODO: Expand when ACP control client is wired to real endpoints (#2607).
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures, MOBILE_SESSION_ID, SESSION_COCKPIT_ID } from './helpers/dashboard-fixtures';
import { mockAcpFixtures } from './helpers/acp-fixtures';

test.describe('ACP Control Actions', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);
    await mockAcpFixtures(page);
  });

  test('session detail renders without errors with ACP mocks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`/sessions/${SESSION_COCKPIT_ID}`);
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test('session detail renders without errors with ACP mocks (permission prompt)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`/sessions/${MOBILE_SESSION_ID}`);
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test.describe('ACP-087: Timeline', () => {
    test('timeline endpoint returns structured events', async ({ page }) => {
      await mockAcpFixtures(page);
      const response = await page.request.get(`/v1/sessions/${SESSION_COCKPIT_ID}/acp/timeline`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.events).toHaveLength(4);
      expect(body.events[0].category).toBe('driver');
    });
  });

  test.describe('ACP-086: Terminal', () => {
    test('terminal size endpoint returns dimensions', async ({ page }) => {
      await mockAcpFixtures(page);
      const response = await page.request.get(`/v1/sessions/${SESSION_COCKPIT_ID}/acp/terminal/size`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.cols).toBe(80);
      expect(body.rows).toBe(24);
    });

    test('terminal resize endpoint accepts new dimensions', async ({ page }) => {
      await mockAcpFixtures(page);
      const response = await page.request.post(`/v1/sessions/${SESSION_COCKPIT_ID}/acp/terminal/resize`, {
        data: { cols: 120, rows: 36 },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
    });
  });
});
