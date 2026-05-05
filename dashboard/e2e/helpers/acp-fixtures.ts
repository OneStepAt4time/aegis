/**
 * e2e/helpers/acp-fixtures.ts — ACP-specific mock API fixtures for E2E tests.
 *
 * Extends dashboard-fixtures with ACP control action, timeline,
 * and terminal endpoints.
 *
 * TODO: Add real ACP endpoints when #2607 (ACP control action endpoints) lands.
 */

import type { Page, Route } from '@playwright/test';

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const now = Date.now();

/** Mock ACP control action endpoints (ACP-064). */
export async function mockAcpControlEndpoints(page: Page): Promise<void> {
  // Control action availability
  await page.route('**/v1/sessions/*/acp/control/availability', (route) =>
    json(route, {
      canPause: true,
      canResume: false,
      canInterrupt: true,
      canApprove: true,
      canReject: true,
      canEscape: true,
      canKill: true,
    }),
  );

  // Pause session
  await page.route('**/v1/sessions/*/acp/control/pause', (route) =>
    json(route, { ok: true, actionId: 'ctrl-pause-test' }),
  );

  // Resume session
  await page.route('**/v1/sessions/*/acp/control/resume', (route) =>
    json(route, { ok: true, actionId: 'ctrl-resume-test' }),
  );

  // Interrupt session
  await page.route('**/v1/sessions/*/acp/control/interrupt', (route) =>
    json(route, { ok: true, actionId: 'ctrl-interrupt-test' }),
  );

  // Kill session
  await page.route('**/v1/sessions/*/acp/control/kill', (route) =>
    json(route, { ok: true, actionId: 'ctrl-kill-test' }),
  );

  // Escape
  await page.route('**/v1/sessions/*/acp/control/escape', (route) =>
    json(route, { ok: true, actionId: 'ctrl-escape-test' }),
  );
}

/** Mock ACP timeline endpoints (ACP-087). */
export async function mockAcpTimelineEndpoints(page: Page): Promise<void> {
  await page.route('**/v1/sessions/*/acp/timeline', (route) =>
    json(route, {
      events: [
        {
          id: 'evt-1',
          timestamp: new Date(now - 60_000).toISOString(),
          category: 'driver',
          description: 'Driver claimed by admin',
          actor: 'admin',
        },
        {
          id: 'evt-2',
          timestamp: new Date(now - 30_000).toISOString(),
          category: 'prompt',
          description: 'Prompt submitted',
          actor: 'admin',
        },
        {
          id: 'evt-3',
          timestamp: new Date(now - 15_000).toISOString(),
          category: 'tool',
          description: 'bash: ls -la',
          actor: 'claude',
          details: { toolName: 'bash', toolStatus: 'completed', durationMs: 150 },
        },
        {
          id: 'evt-4',
          timestamp: new Date(now - 10_000).toISOString(),
          category: 'session',
          description: 'Session paused',
          actor: 'admin',
          details: { sessionFrom: 'running', sessionTo: 'paused' },
        },
      ],
      pagination: { page: 1, limit: 50, total: 4 },
    }),
  );
}

/** Mock ACP terminal endpoints (ACP-086). */
export async function mockAcpTerminalEndpoints(page: Page): Promise<void> {
  await page.route('**/v1/sessions/*/acp/terminal/size', (route) =>
    json(route, { cols: 80, rows: 24 }),
  );

  await page.route('**/v1/sessions/*/acp/terminal/resize', (route) =>
    json(route, { ok: true, cols: 120, rows: 36 }),
  );
}

/** Apply all ACP mock endpoints. */
export async function mockAcpFixtures(page: Page): Promise<void> {
  await mockAcpControlEndpoints(page);
  await mockAcpTimelineEndpoints(page);
  await mockAcpTerminalEndpoints(page);
}
