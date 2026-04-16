import { test, expect } from '@playwright/test';
import { authenticate } from './helpers/auth';

test.describe('Audit Trail Page', () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page);

    await page.route('**/v1/audit**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          records: [
            {
              id: 'audit-1',
              ts: '2026-04-16T10:30:00Z',
              actor: 'admin-key',
              action: 'create',
              sessionId: 'sess-abc123',
              detail: 'Created session',
            },
            {
              id: 'audit-2',
              ts: '2026-04-16T10:35:00Z',
              actor: 'admin-key',
              action: 'send',
              sessionId: 'sess-abc123',
              detail: 'Sent message',
            },
          ],
          total: 2,
          page: 1,
          pageSize: 10,
        }),
      });
    });

    await page.goto('/audit');
  });

  test('renders audit trail heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /audit trail/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Review system actions')).toBeVisible();
  });

  test('renders filter section with inputs', async ({ page }) => {
    await expect(page.getByLabel(/actor/i)).toBeVisible();
    await expect(page.getByLabel(/action/i)).toBeVisible();
    await expect(page.getByLabel(/session id/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /apply/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /clear/i })).toBeVisible();
  });

  test('renders refresh button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible();
  });

  test('renders table with column headers', async ({ page }) => {
    const headers = ['Timestamp', 'Actor', 'Action', 'Session ID', 'Detail'];
    for (const header of headers) {
      await expect(page.getByText(header, { exact: true }).first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test('renders audit records from API', async ({ page }) => {
    await expect(page.getByText('admin-key').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('sess-abc123').first()).toBeVisible();
  });

  test('action badges are color-coded', async ({ page }) => {
    const createAction = page.locator('span', { hasText: 'create' }).first();
    await expect(createAction).toBeVisible();
    const sendAction = page.locator('span', { hasText: 'send' }).first();
    await expect(sendAction).toBeVisible();
  });

  test('pagination controls are visible', async ({ page }) => {
    await expect(page.getByText(/2 records/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/page 1 of 1/i)).toBeVisible();
    await expect(page.getByLabel(/previous page/i)).toBeVisible();
    await expect(page.getByLabel(/next page/i)).toBeVisible();
  });

  test('page size selector works', async ({ page }) => {
    const pageSizeSelect = page.getByLabel(/page size/i);
    await expect(pageSizeSelect).toBeVisible();
  });
});

test.describe('Audit Trail Page — empty state', () => {
  test('shows empty state when no records', async ({ page }) => {
    await authenticate(page);

    await page.route('**/v1/audit**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ records: [], total: 0, page: 1, pageSize: 10 }),
      });
    });

    await page.goto('/audit');
    await expect(page.getByText(/no audit records found/i)).toBeVisible({ timeout: 10_000 });
  });
});
