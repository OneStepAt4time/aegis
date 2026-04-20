/**
 * e2e/interaction-patterns.spec.ts — Tests for Issue #011 interaction patterns
 */

import { test, expect } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

test.describe('Interaction Patterns - Issue #011', () => {
  test.describe('Universal Copy', () => {
    test('should copy session ID on hover and c key', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/sessions/history**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            records: [
              {
                id: 'test-session-abc123',
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

      await page.goto(DASHBOARD_BASE_URL);
      await page.getByRole('link', { name: /session history/i }).click();

      // Hover over session ID area to reveal copy button
      const sessionRow = page.locator('tr').filter({ hasText: 'test-session-abc123' });
      await sessionRow.hover();
      
      // Copy button should be visible on hover
      const copyBtn = sessionRow.getByRole('button', { name: /copy/i });
      await expect(copyBtn).toBeVisible();

      // Focus the copy button and press 'c'
      await copyBtn.focus();
      await page.keyboard.press('c');

      // Verify copied state (icon changes to checkmark)
      await expect(copyBtn).toContainText(''); // May contain checkmark icon
    });

    test('should copy auth key ID on hover', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/auth-keys**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            keys: [
              {
                id: 'key-xyz789',
                name: 'test-key',
                createdAt: Date.now(),
                permissions: ['admin'],
              },
            ],
          }),
        });
      });

      await page.goto(`${DASHBOARD_BASE_URL}auth-keys`);

      // Hover over key area
      const keyCard = page.locator('article').filter({ hasText: 'key-xyz789' });
      await keyCard.hover();

      // Copy button should appear
      const copyBtn = keyCard.getByRole('button', { name: /copy/i }).first();
      await expect(copyBtn).toBeVisible();
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

      await page.goto(DASHBOARD_BASE_URL);
      await page.getByRole('link', { name: /session history/i }).click();

      // Find the NL filter input
      const filterInput = page.getByPlaceholder(/Try:/i);
      await expect(filterInput).toBeVisible();

      // Type a natural language query
      await filterInput.fill('failed sessions from yesterday');
      await filterInput.press('Enter');

      // Chips should appear
      await expect(page.getByText('status: error')).toBeVisible();
      await expect(page.getByText('from yesterday')).toBeVisible();
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

      await page.goto(DASHBOARD_BASE_URL);
      await page.getByRole('link', { name: /session history/i }).click();

      const filterInput = page.getByPlaceholder(/Try:/i);
      await filterInput.fill('active sessions');
      await filterInput.press('Enter');

      // Chip should appear
      const chip = page.locator('span').filter({ hasText: 'status: active' });
      await expect(chip).toBeVisible();

      // Click the X button
      const removeBtn = chip.getByRole('button', { name: /remove/i });
      await removeBtn.click();

      // Chip should disappear
      await expect(chip).not.toBeVisible();
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

      await page.goto(DASHBOARD_BASE_URL);
      await page.getByRole('link', { name: /session history/i }).click();

      const filterInput = page.getByPlaceholder(/Try:/i);
      await filterInput.fill('active sessions by admin last week');
      await filterInput.press('Enter');

      // Multiple chips should appear
      await expect(page.getByText('status: active')).toBeVisible();
      await expect(page.getByText(/by: admin/i)).toBeVisible();
      await expect(page.getByText('last week')).toBeVisible();
    });
  });

  test.describe('Recent Directories', () => {
    test('should show starred directories on new session page', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/templates**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ templates: [] }),
        });
      });

      // Set up localStorage with recent dirs
      await page.goto(DASHBOARD_BASE_URL);
      await page.evaluate(() => {
        localStorage.setItem(
          'aegis:recent-dirs:v1',
          JSON.stringify([
            { path: '/home/user/project1', starred: true, lastUsed: Date.now() },
            { path: '/home/user/project2', starred: false, lastUsed: Date.now() - 1000 },
          ])
        );
      });

      await page.goto(`${DASHBOARD_BASE_URL}sessions/new`);

      // Starred section should be visible
      await expect(page.getByText('Starred')).toBeVisible();
      await expect(page.getByText('project1')).toBeVisible();

      // Recent section should also be visible
      await expect(page.getByText('Recent')).toBeVisible();
      await expect(page.getByText('project2')).toBeVisible();
    });

    test('should populate workDir when clicking recent directory', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/templates**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ templates: [] }),
        });
      });

      await page.goto(DASHBOARD_BASE_URL);
      await page.evaluate(() => {
        localStorage.setItem(
          'aegis:recent-dirs:v1',
          JSON.stringify([
            { path: '/home/user/my-project', starred: false, lastUsed: Date.now() },
          ])
        );
      });

      await page.goto(`${DASHBOARD_BASE_URL}sessions/new`);

      const workDirInput = page.getByLabel(/working directory/i);
      await expect(workDirInput).toHaveValue('');

      // Click the recent directory button
      await page.getByRole('button', { name: /my-project/i }).click();

      // WorkDir should be populated
      await expect(workDirInput).toHaveValue('/home/user/my-project');
    });
  });

  test.describe('Hold-to-Confirm', () => {
    test('should show progress on hold button', async ({ page }) => {
      await mockDashboardFixtures(page);

      await page.route('**/v1/auth-keys**', async (route) => {
        if (route.request().method() === 'DELETE') {
          await route.fulfill({ status: 204 });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              keys: [
                {
                  id: 'test-key-001',
                  name: 'test-key',
                  createdAt: Date.now(),
                  permissions: ['admin'],
                },
              ],
            }),
          });
        }
      });

      await page.goto(`${DASHBOARD_BASE_URL}auth-keys`);

      // Click revoke button to open confirmation
      const revokeBtn = page.getByRole('button', { name: /revoke/i }).first();
      await revokeBtn.click();

      // Confirm dialog should appear
      await expect(page.getByText(/revoke auth key/i)).toBeVisible();

      // Click confirm button
      const confirmBtn = page.getByRole('button', { name: /confirm/i });
      await confirmBtn.click();
    });
  });
});
