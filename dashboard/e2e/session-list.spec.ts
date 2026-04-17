import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

const DASHBOARD_BASE_URL = 'http://localhost:5173/dashboard/';

test.describe('Session History Page', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);

    await page.route('**/v1/sessions/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          records: [
            {
              id: 'sess-001',
              ownerKeyId: 'admin-key',
              createdAt: Math.floor(Date.now() / 1000) - 3600,
              lastSeenAt: Math.floor(Date.now() / 1000),
              finalStatus: 'active',
              source: 'audit+live',
            },
            {
              id: 'sess-002',
              ownerKeyId: 'user-key',
              createdAt: Math.floor(Date.now() / 1000) - 7200,
              lastSeenAt: Math.floor(Date.now() / 1000) - 1800,
              finalStatus: 'killed',
              source: 'live',
            },
          ],
          pagination: { page: 1, limit: 25, total: 2, totalPages: 1 },
        }),
      });
    });

    await page.goto(DASHBOARD_BASE_URL);
    await page.getByRole('link', { name: /session history/i }).click();
  });

  test('renders session history heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Session History', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Merged audit and live session lifecycle')).toBeVisible();
  });

  test('renders refresh button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible();
  });

  test('renders export CSV button when records exist', async ({ page }) => {
    await expect(page.getByRole('button', { name: /export.*csv/i })).toBeVisible({ timeout: 5_000 });
  });

  test('renders filter section with all inputs', async ({ page }) => {
    await expect(page.getByLabel(/owner key id/i)).toBeVisible();
    await expect(page.getByLabel(/status/i)).toBeVisible();
    await expect(page.getByLabel(/session id/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^apply$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^clear$/i })).toBeVisible();
  });

  test('renders date range filter', async ({ page }) => {
    await expect(page.getByLabel(/date range/i)).toBeVisible();
  });

  test('renders sort selector', async ({ page }) => {
    await expect(page.getByLabel(/sort by/i)).toBeVisible();
  });

  test('renders table with column headers', async ({ page }) => {
    const headers = ['Session ID', 'Owner', 'Status', 'Source', 'Created', 'Last seen'];
    for (const header of headers) {
      await expect(page.getByText(header, { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test('renders session records from API', async ({ page }) => {
    await expect(page.getByText('sess-001')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('admin-key')).toBeVisible();
    await expect(page.getByText('sess-002')).toBeVisible();
  });

  test('status badges render with correct text', async ({ page }) => {
    await expect(page.locator('span', { hasText: 'active' }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('span', { hasText: 'killed' }).first()).toBeVisible();
  });

  test('source badges render', async ({ page }) => {
    await expect(page.locator('span', { hasText: 'audit+live' }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('span', { hasText: 'live' }).first()).toBeVisible();
  });

  test('pagination controls visible', async ({ page }) => {
    await expect(page.getByText(/page 1 of 1/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/2 records/)).toBeVisible();
  });

  test('row size selector is visible', async ({ page }) => {
    await expect(page.getByLabel(/rows/i)).toBeVisible();
  });

  test('select all checkbox visible in table header', async ({ page }) => {
    const headerCheckbox = page.locator('thead input[type="checkbox"]').first();
    await expect(headerCheckbox).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Session History Page — empty state', () => {
  test('shows empty state when no records', async ({ page }) => {
    await authenticate(page);

    await page.route('**/v1/sessions/history**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          records: [],
          pagination: { page: 1, limit: 25, total: 0, totalPages: 1 },
        }),
      });
    });

    await page.goto(DASHBOARD_BASE_URL);
    await page.getByRole('link', { name: /session history/i }).click();
    await expect(page.getByText(/no session history records found/i)).toBeVisible({ timeout: 10_000 });
  });
});
