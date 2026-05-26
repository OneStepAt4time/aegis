import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

const mockKeys = [
  {
    id: 'key-001',
    name: 'Admin Key',
    createdAt: '2026-05-01T10:00:00.000Z',
    lastUsedAt: '2026-05-25T18:00:00.000Z',
    isActive: true,
    role: 'admin',
  },
  {
    id: 'key-002',
    name: 'Read-only Key',
    createdAt: '2026-05-10T12:00:00.000Z',
    lastUsedAt: null,
    isActive: true,
    role: 'viewer',
  },
];

test.describe('Auth Keys Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/auth/keys**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          keys: mockKeys,
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}auth/keys`);
  });

  test('renders auth keys page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /auth|key/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders key list', async ({ page }) => {
    await expect(page.getByText('Admin Key')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Read-only Key')).toBeVisible();
  });

  test('renders key roles', async ({ page }) => {
    await expect(page.getByText(/admin|viewer/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('renders create key button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /create|new|add|generate/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders revoke or delete action', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /revoke|delete|remove/i }).or(page.getByText(/revoke/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders empty state when no keys', async ({ page }) => {
    await page.route('**/v1/auth/keys**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          keys: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      });
    });
    await page.reload();
    await expect(page.getByText(/no key|no auth|empty|get started/i)).toBeVisible({ timeout: 10_000 });
  });
});
