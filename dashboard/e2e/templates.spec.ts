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
        body: JSON.stringify(mockTemplates),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}templates`);
  });

  test('renders templates page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /template/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders template list', async ({ page }) => {
    await expect(page.getByText('Code Review', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Bug Fix', { exact: true }).first()).toBeVisible();
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
        body: JSON.stringify([]),
      });
    });
    await page.reload();
    await expect(page.getByText(/no template|empty|get started/i)).toBeVisible({ timeout: 10_000 });
  });
});
