import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

const mockRecords = [
  {
    ts: '2026-04-16T10:30:00.000Z',
    actor: 'admin-key',
    action: 'session.create',
    sessionId: '11111111-1111-1111-1111-111111111111',
    detail: 'Created session one',
    prevHash: '',
    hash: 'hash-1',
  },
  {
    ts: '2026-04-16T10:35:00.000Z',
    actor: 'admin-key',
    action: 'permission.approve',
    sessionId: '11111111-1111-1111-1111-111111111111',
    detail: 'Approved session one',
    prevHash: 'hash-1',
    hash: 'hash-2',
  },
];

function createAuditResponse(records = mockRecords, total = records.length) {
  const first = records[0];
  const last = records[records.length - 1];

  return JSON.stringify({
    count: records.length,
    total,
    records,
    filters: {},
    pagination: {
      limit: 25,
      hasMore: false,
      nextCursor: null,
      reverse: true,
    },
    chain: {
      count: records.length,
      firstHash: first?.hash ?? null,
      lastHash: last?.hash ?? null,
      badgeHash: 'badge-hash',
      firstTs: first?.ts ?? null,
      lastTs: last?.ts ?? null,
    },
  });
}

test.describe('Audit Trail Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/audit**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: createAuditResponse(),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}audit`);
  });

  test('renders audit trail heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /audit trail/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Query admin audit events')).toBeVisible();
  });

  test('renders filter inputs and export actions', async ({ page }) => {
    await expect(page.getByLabel(/actor/i)).toBeVisible();
    await expect(page.getByLabel(/action/i)).toBeVisible();
    await expect(page.getByLabel(/session id/i)).toBeVisible();
    await expect(page.getByLabel(/^from$/i)).toBeVisible();
    await expect(page.getByLabel(/^to$/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^apply$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^clear$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /export ndjson/i })).toBeVisible();
  });

  test('renders audit records from the API', async ({ page }) => {
    // AuditRow renders: actor, action badge, sessionId, truncated hash — NOT detail
    await expect(page.getByText('admin-key').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('session.create').first()).toBeVisible();
    await expect(page.getByText('permission.approve').first()).toBeVisible();
  });

  test('renders pagination controls', async ({ page }) => {
    // Total count renders as "2 records" — use .first() to avoid strict mode with chain badge
    await expect(page.getByText('2 records').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/page 1 of 1/i)).toBeVisible();
    await expect(page.getByLabel(/previous page/i)).toBeVisible();
    await expect(page.getByLabel(/next page/i)).toBeVisible();
  });
});

test.describe('Audit Trail Page — empty state', () => {
  test('shows empty state when no records match', async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/audit**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: createAuditResponse([], 0),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}audit`);
    await expect(page.getByText(/no audit records found/i)).toBeVisible({ timeout: 10_000 });
  });
});
