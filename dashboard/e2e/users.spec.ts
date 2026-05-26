import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

const mockUsers = [
  {
    id: 'user-001',
    username: 'admin',
    email: 'admin@example.com',
    role: 'admin',
    createdAt: '2026-04-01T10:00:00.000Z',
    lastActiveAt: '2026-05-25T20:00:00.000Z',
    isActive: true,
  },
  {
    id: 'user-002',
    username: 'viewer',
    email: 'viewer@example.com',
    role: 'viewer',
    createdAt: '2026-05-01T12:00:00.000Z',
    lastActiveAt: '2026-05-20T14:00:00.000Z',
    isActive: false,
  },
];

test.describe('Users Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/users**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: mockUsers,
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}users`);
  });

  test('renders users page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /user/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders user list', async ({ page }) => {
    await expect(page.getByText('admin')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('viewer')).toBeVisible();
  });

  test('renders user roles', async ({ page }) => {
    await expect(page.getByText(/admin|viewer/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('renders empty state when no users', async ({ page }) => {
    await page.route('**/v1/users**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      });
    });
    await page.reload();
    await expect(page.getByText(/no user|empty|get started/i)).toBeVisible({ timeout: 10_000 });
  });
});
