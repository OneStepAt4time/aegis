import { expect, test, type Page } from '@playwright/test';
import {
  mockDashboardFixtures,
  MOBILE_SESSION_ID,
  QUESTION_SESSION_ID,
} from './helpers/dashboard-fixtures';

const DASHBOARD_BASE_URL = 'http://localhost:5173/dashboard/';

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });

  expect(overflow.documentOverflow).toBeLessThanOrEqual(1);
  expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
}

test.describe('Mobile dashboard flow', () => {
  test.use({
    viewport: { width: 375, height: 667 },
    isMobile: true,
    hasTouch: true,
  });

  test.beforeEach(async ({ page }) => {
    await mockDashboardFixtures(page);
  });

  test('overview and permission detail avoid horizontal overflow on 375x667', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);

    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mobile dashboard pass' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.getByRole('link', { name: 'Mobile dashboard pass' }).click();

    const permissionDialog = page.getByRole('dialog', { name: 'Permission prompt' });
    await expect(permissionDialog).toBeVisible();
    await expect(permissionDialog).toContainText('TTL');
    await expect(permissionDialog.getByText(/\d+:\d\d|expired/)).toBeVisible();
    await assertNoHorizontalOverflow(page);

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    for (const label of ['Approve', 'Reject', 'Escape', 'Kill']) {
      const box = await permissionDialog.getByRole('button', { name: label }).boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport!.height);
    }
  });

  test('question detail keeps reply controls ready for one-thumb answers', async ({ page }) => {
    await page.goto(DASHBOARD_BASE_URL);
    await page.getByRole('link', { name: 'Answer product question' }).click();

    await expect(page.getByText('Claude needs an answer').last()).toBeVisible();
    await expect(page.getByText('What should the empty state CTA say on mobile?').last()).toBeVisible();

    await page.getByRole('button', { name: 'Ship it' }).last().click();
    await expect(page.locator('#session-message-input-mobile')).toHaveValue('Ship it');
    const sendButton = page.getByRole('button', { name: 'Send message' }).last();
    await expect(sendButton).toBeVisible();

    const sendBox = await sendButton.boundingBox();
    const viewport = page.viewportSize();
    expect(sendBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect((sendBox?.y ?? 0) + (sendBox?.height ?? 0)).toBeLessThanOrEqual(viewport!.height);
    await assertNoHorizontalOverflow(page);
  });
});
