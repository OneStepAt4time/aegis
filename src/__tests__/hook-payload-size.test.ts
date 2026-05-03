/**
 * hook-payload-size.test.ts — Tests for Issue #2519.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { SessionEventBus } from '../events.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = '00000000-0000-0000-0000-000000002519';

function makeSession(): SessionInfo {
  return {
    id: SESSION_ID,
    windowId: '@2519',
    windowName: 'hook-size-test',
    workDir: '/tmp/hook-size-test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'working',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
  };
}

function createMockSessions(session: SessionInfo | null): SessionManager {
  return {
    getSession: vi.fn().mockReturnValue(session),
    updateStatusFromHook: vi.fn().mockReturnValue(null),
    updateSessionModel: vi.fn(),
    waitForPermissionDecision: vi.fn().mockResolvedValue('allow'),
    detectWaitingForInput: vi.fn().mockResolvedValue(false),
    addSubagent: vi.fn(),
    removeSubagent: vi.fn(),
    recordHookFailure: vi.fn(),
    recordHookSuccess: vi.fn(),
    checkHookCircuitBreaker: vi.fn().mockReturnValue(false),
  } as unknown as SessionManager;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Hook payload size warning (Issue #2519)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('emits system warning when raw payload exceeds 1.5KB', async () => {
    const session = makeSession();
    const mockSessions = createMockSessions(session);

    const { registerHookRoutes } = await import('../hooks.js');
    app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    const emitted: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(SESSION_ID, (e) => {
      emitted.push({ event: e.event, data: e.data });
    });

    // Use tool_input with a large command — this field survives Zod passthrough()
    const bigCommand = 'x'.repeat(2048);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/SessionStart?sessionId=${SESSION_ID}`,
      payload: { tool_name: 'Bash', tool_input: { command: bigCommand } },
    });

    expect(res.statusCode).toBe(200);
    await delay(100);

    const warnings = emitted.filter(e => e.event === 'system' && e.data.level === 'warn');
    expect(warnings.length).toBe(1);
    expect(warnings[0].data.message).toContain('1536');
  });

  it('does NOT warn when raw payload is under 1.5KB', async () => {
    const session = makeSession();
    const mockSessions = createMockSessions(session);

    const { registerHookRoutes } = await import('../hooks.js');
    app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    const emitted: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(SESSION_ID, (e) => {
      emitted.push({ event: e.event, data: e.data });
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/SessionStart?sessionId=${SESSION_ID}`,
      payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
    });

    expect(res.statusCode).toBe(200);
    await delay(100);

    const warnings = emitted.filter(e => e.event === 'system' && e.data.level === 'warn');
    expect(warnings.length).toBe(0);
  });
});
