import type { Page, Route } from '@playwright/test';
import { authenticate } from './auth';

export const MOBILE_SESSION_ID = 'sess-mobile';
export const QUESTION_SESSION_ID = 'sess-question';

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function mockDashboardFixtures(page: Page): Promise<void> {
  const now = Date.now();

  const makeSession = (
    id: string,
    status: 'permission_prompt' | 'ask_question' | 'idle',
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    windowId: `@${id}`,
    windowName: id === MOBILE_SESSION_ID
      ? 'Mobile dashboard pass'
      : id === QUESTION_SESSION_ID
        ? 'Answer product question'
        : 'Quiet docs sync',
    workDir: 'D:\\src\\aegis\\dashboard',
    byteOffset: 0,
    monitorOffset: 0,
    status,
    createdAt: now - 45 * 60 * 1000,
    lastActivity: now - 45 * 1000,
    stallThresholdMs: 300000,
    permissionMode: 'default',
    ownerKeyId: `${id}-owner`,
    ...overrides,
  });

  const sessions = [
    makeSession(MOBILE_SESSION_ID, 'permission_prompt', {
      permissionPromptAt: now - 2_000,
      pendingPermission: {
        toolName: 'Bash',
        prompt: 'Allow Claude to run npm run deploy in D:\\src\\aegis\\dashboard?',
        startedAt: now - 2_000,
        timeoutMs: 10_000,
        expiresAt: now + 8_000,
        remainingMs: 8_000,
      },
    }),
    makeSession(QUESTION_SESSION_ID, 'ask_question', {
      createdAt: now - 90 * 60 * 1000,
      lastActivity: now - 2 * 60 * 1000,
      pendingQuestion: {
        toolUseId: 'tool-question',
        content: 'What should the empty state CTA say on mobile?',
        options: ['Ship it', 'Revise copy'],
        since: now - 2 * 60 * 1000,
      },
    }),
    makeSession('sess-idle', 'idle', {
      createdAt: now - 3 * 60 * 60 * 1000,
      lastActivity: now - 9 * 60 * 1000,
      permissionMode: 'plan',
    }),
  ];

  const sessionById = Object.fromEntries(sessions.map((session) => [session.id, session]));

  const sessionHealthById = {
    [MOBILE_SESSION_ID]: {
      alive: true,
      windowExists: true,
      claudeRunning: true,
      paneCommand: 'claude',
      status: 'permission_prompt',
      hasTranscript: true,
      lastActivity: now - 45_000,
      lastActivityAgo: 45_000,
      sessionAge: 45 * 60 * 1000,
      details: 'Allow Claude to run npm run deploy in D:\\src\\aegis\\dashboard?',
      actionHints: {
        approve: { method: 'POST', url: `/v1/sessions/${MOBILE_SESSION_ID}/approve`, description: 'Approve the pending permission' },
        reject: { method: 'POST', url: `/v1/sessions/${MOBILE_SESSION_ID}/reject`, description: 'Reject the pending permission' },
      },
    },
    [QUESTION_SESSION_ID]: {
      alive: true,
      windowExists: true,
      claudeRunning: true,
      paneCommand: 'claude',
      status: 'ask_question',
      hasTranscript: true,
      lastActivity: now - 2 * 60 * 1000,
      lastActivityAgo: 2 * 60 * 1000,
      sessionAge: 90 * 60 * 1000,
      details: 'Claude is waiting for an answer before continuing.',
    },
    'sess-idle': {
      alive: true,
      windowExists: true,
      claudeRunning: true,
      paneCommand: 'claude',
      status: 'idle',
      hasTranscript: true,
      lastActivity: now - 9 * 60 * 1000,
      lastActivityAgo: 9 * 60 * 1000,
      sessionAge: 3 * 60 * 60 * 1000,
      details: 'Claude is idle, awaiting input.',
    },
  };

  const sessionMetricsById = {
    [MOBILE_SESSION_ID]: {
      durationSec: 2700,
      messages: 28,
      toolCalls: 14,
      approvals: 3,
      autoApprovals: 0,
      statusChanges: ['working', 'permission_prompt'],
      tokenUsage: { inputTokens: 2200, outputTokens: 1300, cacheCreationTokens: 100, cacheReadTokens: 50, estimatedCostUsd: 0.31 },
    },
    [QUESTION_SESSION_ID]: {
      durationSec: 4200,
      messages: 33,
      toolCalls: 18,
      approvals: 1,
      autoApprovals: 0,
      statusChanges: ['working', 'ask_question'],
      tokenUsage: { inputTokens: 2800, outputTokens: 1600, cacheCreationTokens: 120, cacheReadTokens: 60, estimatedCostUsd: 0.42 },
    },
    'sess-idle': {
      durationSec: 10800,
      messages: 12,
      toolCalls: 6,
      approvals: 0,
      autoApprovals: 1,
      statusChanges: ['working', 'idle'],
      tokenUsage: { inputTokens: 1400, outputTokens: 900, cacheCreationTokens: 40, cacheReadTokens: 20, estimatedCostUsd: 0.12 },
    },
  };

  const latencyById = Object.fromEntries(
    Object.keys(sessionHealthById).map((id) => [
      id,
      {
        sessionId: id,
        realtime: { hook_latency_ms: 18, state_change_detection_ms: 26, permission_response_ms: id === MOBILE_SESSION_ID ? 1800 : null },
        aggregated: {
          hook_latency_ms: { min: 12, max: 28, avg: 18, count: 6 },
          state_change_detection_ms: { min: 20, max: 40, avg: 29, count: 6 },
          permission_response_ms: { min: 1800, max: 1800, avg: 1800, count: id === MOBILE_SESSION_ID ? 1 : 0 },
          channel_delivery_ms: { min: 9, max: 15, avg: 11, count: 6 },
        },
      },
    ]),
  );

  const messagesById = {
    [MOBILE_SESSION_ID]: {
      messages: [
        { role: 'assistant', contentType: 'text', text: 'Ready to continue once you approve this command.', timestamp: new Date(now - 120_000).toISOString() },
        { role: 'assistant', contentType: 'permission_request', text: 'npm run deploy', timestamp: new Date(now - 45_000).toISOString() },
      ],
      status: 'permission_prompt',
      statusText: 'Permission required',
      interactiveContent: 'Allow Claude to run npm run deploy in D:\\src\\aegis\\dashboard?',
    },
    [QUESTION_SESSION_ID]: {
      messages: [
        { role: 'assistant', contentType: 'text', text: 'What should the empty state CTA say on mobile?', timestamp: new Date(now - 180_000).toISOString() },
      ],
      status: 'ask_question',
      statusText: 'Awaiting answer',
      interactiveContent: 'What should the empty state CTA say on mobile?',
    },
    'sess-idle': {
      messages: [
        { role: 'assistant', contentType: 'text', text: 'Docs sync completed successfully.', timestamp: new Date(now - 540_000).toISOString() },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    },
  };

  await authenticate(page);

  await page.addInitScript(() => {
    class MockEventSource {
      url: string;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => this.onopen?.(new Event('open')), 10);
      }

      close() {
        this.readyState = 2;
      }
    }

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = MockWebSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => this.onopen?.(new Event('open')), 10);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.(new Event('close'));
      }
    }

    Object.defineProperty(window, 'EventSource', { value: MockEventSource, configurable: true });
    Object.defineProperty(window, 'WebSocket', { value: MockWebSocket, configurable: true });
  });

  await page.route('https://registry.npmjs.org/@onestepat4time/aegis/latest', (route) =>
    json(route, { version: '0.5.3-alpha' }),
  );
  await page.route('**/v1/auth/sse-token', (route) =>
    json(route, { token: 'e2e-sse-token', expiresAt: now + 60_000 }),
  );
  await page.route('**/v1/health', (route) =>
    json(route, {
      status: 'ok',
      version: '0.5.3-alpha',
      platform: 'win32',
      uptime: 7200,
      sessions: { active: sessions.length, total: 12 },
      tmux: { healthy: true, error: null },
      claude: { available: true, healthy: true, version: '1.0.0', minimumVersion: '1.0.0', error: null },
      timestamp: new Date(now).toISOString(),
    }),
  );
  await page.route('**/v1/metrics', (route) =>
    json(route, {
      uptime: 7200,
      sessions: {
        total_created: 12,
        currently_active: sessions.length,
        completed: 9,
        failed: 0,
        avg_duration_sec: 1800,
        avg_messages_per_session: 24,
      },
      auto_approvals: 2,
      webhooks_sent: 0,
      webhooks_failed: 0,
      screenshots_taken: 3,
      pipelines_created: 1,
      batches_created: 0,
      prompt_delivery: {
        sent: 48,
        delivered: 47,
        failed: 1,
        success_rate: 97.9,
      },
      latency: {
        hook_latency_ms: { min: 12, max: 40, avg: 22, count: 8 },
        state_change_detection_ms: { min: 20, max: 60, avg: 33, count: 8 },
        permission_response_ms: { min: 1000, max: 5000, avg: 2100, count: 3 },
        channel_delivery_ms: { min: 10, max: 18, avg: 13, count: 8 },
      },
    }),
  );
  await page.route('**/v1/sessions/stats', (route) =>
    json(route, {
      active: sessions.length,
      totalCreated: 12,
      totalCompleted: 9,
      totalFailed: 0,
      byStatus: { idle: 1, permission_prompt: 1, ask_question: 1 },
    }),
  );
  await page.route('**/v1/sessions/health', (route) => json(route, sessionHealthById));
  await page.route(/\/v1\/sessions(\?.*)?$/, (route) =>
    json(route, {
      sessions,
      pagination: { page: 1, limit: 20, total: sessions.length, totalPages: 1 },
    }),
  );
  await page.route(/\/v1\/sessions\/sess-[^/]+$/, (route) => {
    if (route.request().method() === 'DELETE') {
      return json(route, { ok: true });
    }
    const id = route.request().url().split('/').at(-1) as string;
    return json(route, sessionById[id]);
  });
  await page.route(/\/v1\/sessions\/sess-[^/]+\/health$/, (route) => {
    const id = route.request().url().split('/').at(-2) as string;
    return json(route, sessionHealthById[id]);
  });
  await page.route(/\/v1\/sessions\/sess-[^/]+\/read$/, (route) => {
    const id = route.request().url().split('/').at(-2) as string;
    return json(route, messagesById[id]);
  });
  await page.route(/\/v1\/sessions\/sess-[^/]+\/pane$/, (route) =>
    json(route, { pane: '$ claude\n> Waiting for input\n' }),
  );
  await page.route(/\/v1\/sessions\/sess-[^/]+\/metrics$/, (route) => {
    const id = route.request().url().split('/').at(-2) as string;
    return json(route, sessionMetricsById[id]);
  });
  await page.route(/\/v1\/sessions\/sess-[^/]+\/latency$/, (route) => {
    const id = route.request().url().split('/').at(-2) as string;
    return json(route, latencyById[id]);
  });
  await page.route(/\/v1\/sessions\/sess-[^/]+\/(send|command|bash)$/, (route) =>
    json(route, { ok: true, delivered: true, attempts: 1 }),
  );
  await page.route(/\/v1\/sessions\/sess-[^/]+\/(approve|reject|interrupt|escape)$/, (route) =>
    json(route, { ok: true }),
  );
}
