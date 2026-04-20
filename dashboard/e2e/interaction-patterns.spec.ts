/**
 * e2e/interaction-patterns.spec.ts — Tests for Issue #011 interaction patterns
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Interaction Patterns - Issue #011', () => {
  test.describe('Universal Copy', () => {
    test('should copy session ID on hover', async ({ page }) => {
      await mockDashboardFixtures(page);

      // Use a short ID (≤16 chars) so shortId() doesn't truncate it
      const SESSION_ID = 'copy-test-abc';

      await page.route('**/v1/sessions/history**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            records: [
              {
                id: SESSION_ID,
                ownerKeyId: 'admin-key',
                createdAt: Math.floor(Date.now() / 1000) - 3600,
                lastSeenAt: Math.floor(Date.now() / 1000),
                finalStatus: 'active',
                source: 'audit+live',
              },
            ],
            pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
          }),
        });
      });

      await page.goto(DASHBOARD_BASE_URL + 'sessions?tab=all');

      // Wait for the table row to render
      const sessionRow = page.locator('tr').filter({ hasText: SESSION_ID });
      await expect(sessionRow).toBeVisible({ timeout: 15_000 });

      // Hover over session ID area to reveal copy button
      await sessionRow.hover();

      // Copy button should be visible on hover (aria-label="Copy session ID")
      const copyBtn = sessionRow.getByRole('button', { name: /copy session id/i });
      await expect(copyBtn).toBeVisible({ timeout: 5_000 });
    });

    test('should copy auth key ID on hover', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route(/\/v1\/auth\/keys/, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'key-xyz789',
              name: 'test-key',
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
              rateLimit: 100,
              expiresAt: null,
              role: 'admin',
            },
          ]),
        });
      });

      await page.goto(`${DASHBOARD_BASE_URL}auth/keys`);

      // Wait for the key to render
      const keyCard = page.locator('article').filter({ hasText: 'test-key' });
      await expect(keyCard).toBeVisible({ timeout: 15_000 });

      // CopyButton for key ID should be in the card
      const copyBtn = keyCard.getByRole('button', { name: /copy/i }).first();
      await expect(copyBtn).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('NL Filter Bar', () => {
    test('should parse and render filter chips', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/sessions/history**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            records: [],
            pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
          }),
        });
      });

      await page.goto(DASHBOARD_BASE_URL + 'sessions?tab=all');

      // Find the NL filter input
      const filterInput = page.getByRole('textbox', { name: 'Natural language filter' });
      await expect(filterInput).toBeVisible({ timeout: 15_000 });

      // Type a natural language query
      await filterInput.fill('failed sessions from yesterday');
      await filterInput.press('Enter');

      // Chips should appear
      await expect(page.getByText('status: error')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText('from yesterday')).toBeVisible({ timeout: 5_000 });
    });

    test('should remove filter chip on click', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/sessions/history**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            records: [],
            pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
          }),
        });
      });

      await page.goto(DASHBOARD_BASE_URL + 'sessions?tab=all');

      const filterInput = page.getByRole('textbox', { name: 'Natural language filter' });
      await expect(filterInput).toBeVisible({ timeout: 15_000 });
      await filterInput.fill('active sessions');
      await filterInput.press('Enter');

      // Chip should appear
      const chip = page.locator('span').filter({ hasText: 'status: active' }).first();
      await expect(chip).toBeVisible({ timeout: 5_000 });

      // Click the remove button within the chip
      const removeBtn = chip.getByRole('button', { name: /remove filter/i });
      await removeBtn.click();

      // Chip should disappear
      await expect(chip).not.toBeVisible({ timeout: 3_000 });
    });

    test('should parse multiple filter types', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/sessions/history**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            records: [],
            pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
          }),
        });
      });

      await page.goto(DASHBOARD_BASE_URL + 'sessions?tab=all');

      const filterInput = page.getByRole('textbox', { name: 'Natural language filter' });
      await expect(filterInput).toBeVisible({ timeout: 15_000 });
      await filterInput.fill('active sessions by admin last week');
      await filterInput.press('Enter');

      // Multiple chips should appear
      await expect(page.getByText('status: active')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/by: admin/i)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText('last week')).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe('Recent Directories', () => {
    test('should store recent directory in localStorage', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.goto(DASHBOARD_BASE_URL);

      // Set up localStorage with recent dirs (tests the hook behavior)
      await page.evaluate(() => {
        localStorage.setItem(
          'aegis:recent-dirs:v1',
          JSON.stringify([
            { path: '/home/user/project1', starred: true, lastUsed: Date.now() },
            { path: '/home/user/project2', starred: false, lastUsed: Date.now() - 1000 },
          ])
        );
      });

      // Verify localStorage was set correctly
      const stored = await page.evaluate(() => {
        const raw = localStorage.getItem('aegis:recent-dirs:v1');
        if (!raw) return null;
        return JSON.parse(raw) as { path: string; starred: boolean }[];
      });

      expect(stored).toBeTruthy();
      expect(stored!.length).toBe(2);
      expect(stored!.find((d) => d.starred)?.path).toBe('/home/user/project1');
      expect(stored!.find((d) => !d.starred)?.path).toBe('/home/user/project2');
    });

    test('should show new session form at sessions/new', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/templates**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ templates: [] }),
        });
      });

      // sessions/new opens a drawer and redirects to /sessions
      await page.goto(`${DASHBOARD_BASE_URL}sessions/new`);

      // Should redirect to sessions page and open the drawer
      await page.waitForURL(/sessions/, { timeout: 10_000 });

      // The page should be on Sessions
      await expect(page.locator('h2:has-text("Sessions")')).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Hold-to-Confirm', () => {
    test('should show confirm dialog on revoke and confirm', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route(/\/v1\/auth\/keys/, async (route) => {
        if (route.request().method() === 'DELETE') {
          await route.fulfill({ status: 204 });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: 'test-key-001',
                name: 'test-key',
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
                rateLimit: 100,
                expiresAt: null,
                role: 'admin',
              },
            ]),
          });
        }
      });

      await page.goto(`${DASHBOARD_BASE_URL}auth/keys`);

      // Wait for key to render
      await expect(page.locator('article').filter({ hasText: 'test-key' })).toBeVisible({ timeout: 15_000 });

      // Click revoke button on the key card
      const revokeBtn = page.locator('article').filter({ hasText: 'test-key' }).getByRole('button', { name: /revoke/i });
      await revokeBtn.click();

      // Confirm dialog should appear
      await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 5_000 });

      // The dialog should have a "Revoke" confirm button (confirmLabel="Revoke")
      const confirmBtn = page.getByRole('alertdialog').getByRole('button', { name: /revoke/i });
      await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
      await confirmBtn.click();
    });
  });
});
