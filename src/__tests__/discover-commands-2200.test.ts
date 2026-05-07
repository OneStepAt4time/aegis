/**
 * discover-commands-2200.test.ts — Tests for Issue #2200:
 * POST /v1/sessions/:id/discover-commands endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerSessionActionRoutes } from '../routes/session-actions.js';
import type { RouteContext } from '../routes/context.js';

// ── Regex unit tests ──────────────────────────────────────────────────

const SLASH_CMD_PATTERN = /\/(\S+)\s{2,}(.+)/;

describe('SLASH_CMD_PATTERN regex (Issue #2200)', () => {
  it('matches /command with description', () => {
    const match = SLASH_CMD_PATTERN.exec('/compact  Compact conversation');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('compact');
    expect(match![2]).toBe('Compact conversation');
  });

  it('matches command with leading whitespace', () => {
    const match = SLASH_CMD_PATTERN.exec('  /clear    Clear conversation history');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('clear');
    expect(match![2]).toBe('Clear conversation history');
  });

  it('matches command with multi-word description', () => {
    const match = SLASH_CMD_PATTERN.exec('/config  View and manage configuration settings');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('config');
    expect(match![2]).toBe('View and manage configuration settings');
  });

  it('matches command with prefix marker (e.g. > for selected item)', () => {
    const match = SLASH_CMD_PATTERN.exec('> /help  Show available commands');
    expect(match).not.toBeNull();
    expect(match![1]).toBe('help');
    expect(match![2]).toBe('Show available commands');
  });

  it('does not match single-spaced command without description', () => {
    const match = SLASH_CMD_PATTERN.exec('/compact');
    expect(match).toBeNull();
  });

  it('does not match command with only one space before description', () => {
    const match = SLASH_CMD_PATTERN.exec('/compact description');
    expect(match).toBeNull();
  });

  it('does not match command with trailing spaces only', () => {
    const match = SLASH_CMD_PATTERN.exec('/compact  ');
    expect(match).toBeNull();
  });

  it('deduplicates commands keeping first description', () => {
    const commands = new Map<string, string>();
    const lines = [
      '/compact  Compact conversation',
      '/compact  Different description',
      '/clear  Clear history',
    ];
    for (const line of lines) {
      const match = SLASH_CMD_PATTERN.exec(line);
      if (match) {
        const name = match[1];
        if (!commands.has(name)) {
          commands.set(name, match[2].trim());
        }
      }
    }
    expect(commands.size).toBe(2);
    expect(commands.get('compact')).toBe('Compact conversation');
    expect(commands.get('clear')).toBe('Clear history');
  });
});

// ── Route registration and handler tests ───────────────────────────────

type RequestHandler = (...args: unknown[]) => unknown;

function makeMockApp(): FastifyInstance & {
  getRoutes: () => Map<string, { handler: RequestHandler }>;
} {
  const routes = new Map<string, { handler: RequestHandler }>();
  return {
    post: vi.fn((path: string, handlerOrOpts: unknown) => {
      const handler = typeof handlerOrOpts === 'function'
        ? (handlerOrOpts as RequestHandler)
        : (handlerOrOpts as Record<string, unknown>).handler as RequestHandler;
      routes.set(`POST ${path}`, { handler });
    }),
    get: vi.fn((path: string, handlerOrOpts: unknown) => {
      const handler = typeof handlerOrOpts === 'function'
        ? (handlerOrOpts as RequestHandler)
        : (handlerOrOpts as Record<string, unknown>).handler as RequestHandler;
      routes.set(`GET ${path}`, { handler });
    }),
    delete: vi.fn((path: string, handlerOrOpts: unknown) => {
      const handler = typeof handlerOrOpts === 'function'
        ? (handlerOrOpts as RequestHandler)
        : (handlerOrOpts as Record<string, unknown>).handler as RequestHandler;
      routes.set(`DELETE ${path}`, { handler });
    }),
    put: vi.fn((path: string, handlerOrOpts: unknown) => {
      const handler = typeof handlerOrOpts === 'function'
        ? (handlerOrOpts as RequestHandler)
        : (handlerOrOpts as Record<string, unknown>).handler as RequestHandler;
      routes.set(`PUT ${path}`, { handler });
    }),
    getRoutes: () => routes,
  } as unknown as FastifyInstance & { getRoutes: () => Map<string, { handler: RequestHandler }> };
}

function makeRouteContext(overrides?: Partial<{
  sessionId: string;
  windowId: string;
}>): RouteContext {
  const sessionId = overrides?.sessionId ?? '00000000-0000-0000-0000-000000000001';
  const windowId = overrides?.windowId ?? '@1';

  const mockSessions = {
    getSession: vi.fn(() => ({
      id: sessionId,
      windowId,
      displayName: 'test-session',
      workDir: '/tmp',
      status: 'idle',
      createdAt: Date.now(),
      ownerKeyId: undefined,
    })),
    listSessions: vi.fn(() => []),
    sendMessage: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    escape: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    killSession: vi.fn(async () => {}),
    getLatencyMetrics: vi.fn(() => ({ permission_response_ms: null })),
    getStallInfo: vi.fn(() => ({ stalled: false })),
    submitAnswer: vi.fn(() => true),
    getPendingPermissionInfo: vi.fn(() => null),
    getPendingQuestionInfo: vi.fn(() => null),
    sendInitialPrompt: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    save: vi.fn(async () => {}),
  };

  const mockAuth = {
    authEnabled: false,
    hasPermission: vi.fn(() => true),
    getRole: vi.fn(() => 'admin'),
    validate: vi.fn(() => ({ valid: true })),
  };

  return {
    sessions: mockSessions as unknown as RouteContext['sessions'],
    auth: mockAuth as unknown as RouteContext['auth'],
    quotas: { checkSendQuota: vi.fn(() => ({ allowed: true })) } as unknown as RouteContext['quotas'],
    config: { enforceSessionOwnership: false } as unknown as RouteContext['config'],
    metrics: {
      recordPermissionResponse: vi.fn(),
      sessionFailed: vi.fn(),
    } as unknown as RouteContext['metrics'],
    monitor: { getStallInfo: vi.fn(() => ({ stalled: false })) } as unknown as RouteContext['monitor'],
    eventBus: { emitEnded: vi.fn() } as unknown as RouteContext['eventBus'],
    channels: {
      message: vi.fn(async () => {}),
      sessionCreated: vi.fn(async () => {}),
      sessionEnded: vi.fn(async () => {}),
      getChannels: vi.fn(() => []),
      count: 0,
    } as unknown as RouteContext['channels'],
    jsonlWatcher: {} as unknown as RouteContext['jsonlWatcher'],
    pipelines: {} as unknown as RouteContext['pipelines'],
    toolRegistry: {} as unknown as RouteContext['toolRegistry'],
    getAuditLogger: vi.fn(() => undefined),
    alertManager: {} as unknown as RouteContext['alertManager'],
    sseLimiter: {} as unknown as RouteContext['sseLimiter'],
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: vi.fn(async () => '/tmp'),
    serverState: { draining: false },
    metering: {} as unknown as RouteContext['metering'],
    metricsCache: {} as unknown as RouteContext['metricsCache'],
  };
}

describe('ACP-062: tmux-specific endpoints removed (#2605)', () => {
  it('does not register /v1/sessions/:id/discover-commands', () => {
    const app = makeMockApp();
    const ctx = makeRouteContext();
    registerSessionActionRoutes(app, ctx);
    const routes = app.getRoutes();
    expect(routes.has('POST /v1/sessions/:id/discover-commands')).toBe(false);
    expect(routes.has('POST /sessions/:id/discover-commands')).toBe(false);
  });

  it('does not register /v1/sessions/:id/pane', () => {
    const app = makeMockApp();
    const ctx = makeRouteContext();
    registerSessionActionRoutes(app, ctx);
    const routes = app.getRoutes();
    expect(routes.has('GET /v1/sessions/:id/pane')).toBe(false);
    expect(routes.has('GET /sessions/:id/pane')).toBe(false);
  });

  it('does not register /v1/sessions/:id/bash', () => {
    const app = makeMockApp();
    const ctx = makeRouteContext();
    registerSessionActionRoutes(app, ctx);
    const routes = app.getRoutes();
    expect(routes.has('POST /v1/sessions/:id/bash')).toBe(false);
    expect(routes.has('POST /sessions/:id/bash')).toBe(false);
  });
});
