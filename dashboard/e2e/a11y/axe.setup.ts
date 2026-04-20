import { checkA11y } from 'axe-playwright';
import type { Page } from '@playwright/test';

export async function auditPage(page: Page, options = {}) {
  await checkA11y(page, undefined, {
    detailedReport: true,
    detailedReportOptions: { html: true },
    ...options,
  });
}
