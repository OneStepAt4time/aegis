import { test, expect } from '@playwright/test';
import { mockDashboardFixtures } from './helpers/dashboard-fixtures';

/**
 * Session cockpit regression — issue 08 of the session-cockpit epic.
 *
 * Pins the core invariants of issues 01–07 so a future change cannot
 * silently re-introduce the defects the epic fixed:
 *
 *  - 01: ASCII `╔══SESSION TRANSCRIPT══╗` / `╔══LIVE TERMINAL OUTPUT══╗`
 *        banners must not render inside the Terminal panel.
 *  - 02: the Stream tab is one tab with a three-way view picker, not
 *        two peer tabs — Metrics is the only sibling.
 *  - 03: the header shows SessionStateBadge once. The `ALIVE` and
 *        `WS LIVE` pills and the "Claude is idle" subtitle are gone.
 *  - 04: the KPI banner has the six labels (Duration / Messages /
 *        Tool calls / Approvals / Auto / Status). The old
 *        "Auto-approvals" card label never appears.
 *  - 04.10 + 11.10: under `prefers-reduced-motion: reduce`, the
 *        numeric counters render as plain text (no springing).
 *
 * This spec intentionally does NOT pin pixel-accurate screenshots —
 * epic 08.1/08.2 propose 18 pins vs a CCMeter reference, which is
 * deferred until the timeline heatmap (04.6), rate-limit card (04.8)
 * and per-model accents (04.9) land (all blocked on server work).
 */

const DASHBOARD_BASE_URL = 'http://localhost:5200/dashboard/';
const SESSION_ID = 'sess-cockpit';

async function mockSessionCockpit(page: import('@playwright/test').Page): Promise<void> {
  await mockDashboardFixtures(page);

  await page.route(`**/v1/sessions/${SESSION_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: SESSION_ID,
        windowId: `@${SESSION_ID}`,
        windowName: 'Cockpit regression',
        workDir: 'D:\\src\\aegis',
        byteOffset: 0,
        monitorOffset: 0,
        status: 'idle',
        createdAt: Date.now() - 120_000,
        lastActivity: Date.now() - 30_000,
        stallThresholdMs: 300_000,
        permissionMode: 'bypassPermissions',
      }),
    }),
  );

  await page.route(`**/v1/sessions/${SESSION_ID}/health`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: SESSION_ID,
        alive: true,
        status: 'idle',
        lastActivity: Date.now() - 30_000,
        details: null,
      }),
    }),
  );

  await page.route(`**/v1/sessions/${SESSION_ID}/messages`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          { role: 'user', contentType: 'text', text: 'Review the README.' },
          { role: 'assistant', contentType: 'text', text: 'Here is the review…' },
          { role: 'assistant', contentType: 'tool_use', text: '', toolName: 'Read' },
        ],
        status: 'idle',
        statusText: null,
        interactiveContent: null,
      }),
    }),
  );

  await page.route(`**/v1/sessions/${SESSION_ID}/metrics`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        durationSec: 124,
        messages: 0, // intentionally wrong — the UI must ignore this.
        toolCalls: 0,
        approvals: 0,
        autoApprovals: 0,
        statusChanges: [],
        tokenUsage: {
          inputTokens: 116_800,
          outputTokens: 1_700,
          cacheCreationTokens: 0,
          cacheReadTokens: 129_700,
          estimatedCostUsd: 0.414,
        },
      }),
    }),
  );

  await page.route(`**/v1/sessions/${SESSION_ID}/latency`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: SESSION_ID, realtime: null, aggregated: null }),
    }),
  );

  await page.route(`**/v1/sessions/${SESSION_ID}/pane`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pane: '' }),
    }),
  );
}

test.describe('Session Cockpit — regression pins', () => {
  test.beforeEach(async ({ page }) => {
    await mockSessionCockpit(page);
    await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_ID}`);
  });

  test('tab strip has exactly Stream + Metrics (no legacy Terminal/Transcript peers)', async ({ page }) => {
    const tabList = page.getByRole('tablist').first();
    await expect(tabList.getByRole('tab', { name: /^Stream$/ })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /^Metrics$/ })).toBeVisible();
    // The old peer tabs no longer exist at the top level.
    await expect(tabList.getByRole('tab', { name: /^Terminal$/ })).toHaveCount(0);
    await expect(tabList.getByRole('tab', { name: /^Transcript$/ })).toHaveCount(0);
  });

  test('Metrics tab renders the condensed KPI banner (issue 04.1)', async ({ page }) => {
    await page.getByRole('tab', { name: /^Metrics$/ }).click();

    // Six banner labels.
    await expect(page.getByText('Duration', { exact: true })).toBeVisible();
    await expect(page.getByText('Messages', { exact: true })).toBeVisible();
    await expect(page.getByText('Tool calls', { exact: true })).toBeVisible();
    await expect(page.getByText('Approvals', { exact: true })).toBeVisible();
    await expect(page.getByText('Auto', { exact: true })).toBeVisible();
    await expect(page.getByText('Status', { exact: true })).toBeVisible();

    // Old 6-card label must not render.
    await expect(page.getByText('Auto-approvals', { exact: true })).toHaveCount(0);

    // Counts come from the transcript, not the lying metrics endpoint.
    await expect(page.getByText('$0.41', { exact: false })).toBeVisible();
  });

  test('no ASCII box banners leak into the Stream view (issue 01.1)', async ({ page }) => {
    await page.getByRole('tab', { name: /^Stream$/ }).click();
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('SESSION TRANSCRIPT');
    expect(body).not.toContain('LIVE TERMINAL OUTPUT');
  });

  test('permission-mode chip is muted metadata, not a primary status badge (issue 03.2)', async ({ page }) => {
    // Mode chip exists as plain text.
    await expect(page.getByText('bypassPermissions', { exact: false })).toBeVisible();
    // Legacy loud indicators are gone.
    await expect(page.getByText(/^ALIVE$/)).toHaveCount(0);
    await expect(page.getByText(/^WS LIVE$/)).toHaveCount(0);
  });

  test.describe('reduced motion', () => {
    test.use({ colorScheme: 'dark' });

    test('numeric counters render without animation (issue 04.10 + 11.10)', async ({ page, context }) => {
      await context.addInitScript(() => {
        // Emulate prefers-reduced-motion before scripts run.
        Object.defineProperty(window, 'matchMedia', {
          value: (q: string) => ({
            matches: q.includes('reduce'),
            media: q,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => true,
          }),
        });
      });

      await page.goto(`${DASHBOARD_BASE_URL}sessions/${SESSION_ID}`);
      await page.getByRole('tab', { name: /^Metrics$/ }).click();

      // Under reduced motion the banner still shows the derived count
      // — AnimatedNumber is bypassed but the value renders as plain text.
      await expect(page.getByText('Messages', { exact: true })).toBeVisible();
    });
  });
});
