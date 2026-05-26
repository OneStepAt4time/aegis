import { expect, test } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';

const mockPipelines = [
  {
    id: 'pipe-001',
    name: 'Deploy to staging',
    status: 'completed',
    createdAt: '2026-05-25T10:00:00.000Z',
    updatedAt: '2026-05-25T10:15:00.000Z',
    steps: [
      { id: 'step-1', name: 'Build', status: 'completed', duration: 120 },
      { id: 'step-2', name: 'Test', status: 'completed', duration: 300 },
      { id: 'step-3', name: 'Deploy', status: 'completed', duration: 60 },
    ],
  },
  {
    id: 'pipe-002',
    name: 'Security scan',
    status: 'running',
    createdAt: '2026-05-25T12:00:00.000Z',
    updatedAt: '2026-05-25T12:05:00.000Z',
    steps: [
      { id: 'step-1', name: 'Scan', status: 'running', duration: null },
    ],
  },
];

test.describe('Pipelines Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);

    await page.route('**/v1/pipelines**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pipelines: mockPipelines,
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
        }),
      });
    });

    await page.goto(`${DASHBOARD_BASE_URL}pipelines`);
  });

  test('renders pipelines page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /pipeline/i })).toBeVisible({ timeout: 10_000 });
  });

  test('renders pipeline list', async ({ page }) => {
    await expect(page.getByText('Deploy to staging')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Security scan')).toBeVisible();
  });

  test('renders pipeline statuses', async ({ page }) => {
    await expect(page.getByText(/completed|running/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('renders create pipeline button or empty state', async ({ page }) => {
    // Should have either a create button or an empty state
    await expect(
      page.getByRole('button', { name: /create|new/i }).or(page.getByText(/no pipeline/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('renders empty state when no pipelines', async ({ page }) => {
    await page.route('**/v1/pipelines**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pipelines: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        }),
      });
    });
    await page.reload();
    await expect(page.getByText(/no pipeline|empty|get started/i)).toBeVisible({ timeout: 10_000 });
  });
});
