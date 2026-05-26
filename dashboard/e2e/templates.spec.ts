import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

const mockTemplates = [
  {
    id: 'tpl-001',
    name: 'Code Review',
    description: 'Standard code review template',
    model: 'claude-sonnet-4-20250514',
    createdAt: '2026-05-20T10:00:00.000Z',
  },
  {
    id: 'tpl-002',
    name: 'Bug Fix',
    description: 'Bug fix with tests template',
    model: 'claude-sonnet-4-20250514',
    createdAt: '2026-05-21T14:00:00.000Z',
  },
];

test.describe('Templates Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/templates**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          templates: mockTemplates,
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}templates`);
  });

  test('renders templates page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /template/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders template list', async ({ page }) => {
    await expect(page.getByText('Code Review')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Bug Fix')).toBeVisible();
  });

  test('renders template descriptions', async ({ page }) => {
    await expect(page.getByText('Standard code review template')).toBeVisible({ timeout: 10_000 });
  });

  test('renders create template button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /create|new|add/i }).or(page.getByText(/create template/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders empty state when no templates', async ({ page }) => {
    await page.route('**/v1/templates**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          templates: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      });
    });
    await page.reload();
    await expect(page.getByText(/no template|empty|get started/i)).toBeVisible({ timeout: 10_000 });
  });
});
