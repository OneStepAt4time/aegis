/**
 * hook-circuit-breaker.test.ts — Tests for Issue #2518.
 *
 * A user-defined Stop hook returning ok:false causes CC to retry in an
 * infinite loop, burning the entire session. Aegis detects rapid StopFailure
 * events and trips a circuit breaker, returning ok:true to break the loop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { SessionEventBus } from '../events.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

/** Flush all pending setImmediate callbacks (needed because eventBus.emit is async). */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

const SESSION_ID = '00000000-0000-0000-0000-000000002518';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    windowId: '@2518',
    windowName: 'cc-cb-test',
    workDir: '/tmp/cb-test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'error',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    hookFailureTimestamps: [],
    circuitBreakerTripped: false,
    ...overrides,
  };
}

function createMockSessions(session: SessionInfo | null, opts: {
  checkResult: boolean;
} = { checkResult: false }): SessionManager {
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
    checkHookCircuitBreaker: vi.fn().mockReturnValue(opts.checkResult),
  } as unknown as SessionManager;
}

// ─── SessionManager unit tests ────────────────────────────────────────────────

describe('SessionManager circuit breaker methods (Issue #2518)', () => {
  it('recordHookFailure + checkHookCircuitBreaker: trips after maxFailures', async () => {
    // Use real SessionManager with a minimal config so we can test the logic directly.
    // We import dynamically to avoid test isolation issues.
    vi.resetModules();
    const { SessionManager } = await import('../session.js');
    const mockTmux = {
      listWindows: vi.fn().mockResolvedValue([]),
      listPanePid: vi.fn().mockResolvedValue(null),
    };
    const mockConfig = {
      stateDir: '/tmp/cb-test-state',
      defaultPermissionMode: 'default',
      defaultSessionEnv: {},
    };
    const sm = new (SessionManager as unknown as new (...args: unknown[]) => InstanceType<typeof SessionManager>)(
      mockTmux,
      mockConfig,
    );

    // Inject session directly via private state
    const sessions = (sm as unknown as Record<string, unknown>).state as { sessions: Record<string, SessionInfo> };
    const session = makeSession();
    sessions.sessions[SESSION_ID] = session;

    // 4 failures should not trip (max = 5)
    for (let i = 0; i < 4; i++) {
      sm.recordHookFailure(SESSION_ID);
    }
    expect(sm.checkHookCircuitBreaker(SESSION_ID, 5, 60_000)).toBe(false);

    // 5th failure tips it over
    sm.recordHookFailure(SESSION_ID);
    expect(sm.checkHookCircuitBreaker(SESSION_ID, 5, 60_000)).toBe(true);
    expect(session.circuitBreakerTripped).toBe(true);
  });

  it('recordHookSuccess resets circuit breaker', async () => {
    vi.resetModules();
    const { SessionManager } = await import('../session.js');
    const mockTmux = { listWindows: vi.fn().mockResolvedValue([]), listPanePid: vi.fn().mockResolvedValue(null) };
    const mockConfig = { stateDir: '/tmp/cb-test-state2', defaultPermissionMode: 'default', defaultSessionEnv: {} };
    const sm = new (SessionManager as unknown as new (...args: unknown[]) => InstanceType<typeof SessionManager>)(mockTmux, mockConfig);

    const sessions = (sm as unknown as Record<string, unknown>).state as { sessions: Record<string, SessionInfo> };
    const session = makeSession({ circuitBreakerTripped: true, hookFailureTimestamps: [Date.now(), Date.now()] });
    sessions.sessions[SESSION_ID] = session;

    sm.recordHookSuccess(SESSION_ID);
    expect(session.circuitBreakerTripped).toBe(false);
    expect(session.hookFailureTimestamps).toHaveLength(0);
    expect(sm.checkHookCircuitBreaker(SESSION_ID, 5, 60_000)).toBe(false);
  });

  it('checkHookCircuitBreaker prunes timestamps outside the window', async () => {
    vi.resetModules();
    const { SessionManager } = await import('../session.js');
    const mockTmux = { listWindows: vi.fn().mockResolvedValue([]), listPanePid: vi.fn().mockResolvedValue(null) };
    const mockConfig = { stateDir: '/tmp/cb-test-state3', defaultPermissionMode: 'default', defaultSessionEnv: {} };
    const sm = new (SessionManager as unknown as new (...args: unknown[]) => InstanceType<typeof SessionManager>)(mockTmux, mockConfig);

    const sessions = (sm as unknown as Record<string, unknown>).state as { sessions: Record<string, SessionInfo> };
    const stale = Date.now() - 120_000; // 2 min ago — outside a 60s window
    const session = makeSession({
      hookFailureTimestamps: [stale, stale, stale, stale, stale], // 5 stale entries
    });
    sessions.sessions[SESSION_ID] = session;

    // Should NOT trip — all timestamps are outside the 60s window
    expect(sm.checkHookCircuitBreaker(SESSION_ID, 5, 60_000)).toBe(false);
    expect(session.hookFailureTimestamps).toHaveLength(0); // pruned
  });

  it('once tripped, checkHookCircuitBreaker keeps returning true', async () => {
    vi.resetModules();
    const { SessionManager } = await import('../session.js');
    const mockTmux = { listWindows: vi.fn().mockResolvedValue([]), listPanePid: vi.fn().mockResolvedValue(null) };
    const mockConfig = { stateDir: '/tmp/cb-test-state4', defaultPermissionMode: 'default', defaultSessionEnv: {} };
    const sm = new (SessionManager as unknown as new (...args: unknown[]) => InstanceType<typeof SessionManager>)(mockTmux, mockConfig);

    const sessions = (sm as unknown as Record<string, unknown>).state as { sessions: Record<string, SessionInfo> };
    const session = makeSession({ circuitBreakerTripped: true });
    sessions.sessions[SESSION_ID] = session;

    expect(sm.checkHookCircuitBreaker(SESSION_ID, 5, 60_000)).toBe(true);
    expect(sm.checkHookCircuitBreaker(SESSION_ID, 5, 60_000)).toBe(true);
  });
});

// ─── Hook route integration tests ─────────────────────────────────────────────

describe('Hook route circuit breaker integration (Issue #2518)', () => {
  let app: ReturnType<typeof Fastify>;
  let eventBus: SessionEventBus;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns ok:true and emits circuit_breaker event when breaker is tripped', async () => {
    const session = makeSession();
    const mockSessions = createMockSessions(session, { checkResult: true });

    const { registerHookRoutes } = await import('../hooks.js');
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    const emitted: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(SESSION_ID, (e) => emitted.push({ event: e.event, data: e.data }));

    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/StopFailure?sessionId=${SESSION_ID}`,
      payload: { error: 'hook returned ok:false' },
    });
    await flushAsync();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    const cbEvent = emitted.find(e => e.event === 'circuit_breaker');
    expect(cbEvent).toBeDefined();
    expect(cbEvent?.data.reason).toBe('StopFailure threshold exceeded');
    expect(typeof cbEvent?.data.maxFailures).toBe('number');
    expect(typeof cbEvent?.data.windowMs).toBe('number');
  });

  it('calls recordHookFailure and checkHookCircuitBreaker on StopFailure', async () => {
    const session = makeSession();
    const mockSessions = createMockSessions(session, { checkResult: false });

    const { registerHookRoutes } = await import('../hooks.js');
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/StopFailure?sessionId=${SESSION_ID}`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockSessions.recordHookFailure).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessions.checkHookCircuitBreaker).toHaveBeenCalledWith(
      SESSION_ID,
      expect.any(Number),
      expect.any(Number),
    );
    // Not tripped — regular ok:true response (non-decision event)
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('calls recordHookSuccess on Stop and does NOT call recordHookFailure', async () => {
    const session = makeSession({ status: 'idle' });
    const mockSessions = createMockSessions(session, { checkResult: false });

    const { registerHookRoutes } = await import('../hooks.js');
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${SESSION_ID}`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(mockSessions.recordHookSuccess).toHaveBeenCalledWith(SESSION_ID);
    expect(mockSessions.recordHookFailure).not.toHaveBeenCalled();
  });

  it('does NOT call recordHookFailure or recordHookSuccess for unrelated events', async () => {
    const session = makeSession({ status: 'working' });
    const mockSessions = createMockSessions(session, { checkResult: false });

    const { registerHookRoutes } = await import('../hooks.js');
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PostToolUse?sessionId=${SESSION_ID}`,
      payload: { tool_name: 'Bash', tool_input: {} },
    });

    expect(mockSessions.recordHookFailure).not.toHaveBeenCalled();
    expect(mockSessions.recordHookSuccess).not.toHaveBeenCalled();
  });

  it('respects HOOK_CIRCUIT_BREAKER_MAX env var', async () => {
    const originalMax = process.env.HOOK_CIRCUIT_BREAKER_MAX;
    // Set env var BEFORE the dynamic import so the module-level constant picks it up
    process.env.HOOK_CIRCUIT_BREAKER_MAX = '3';

    try {
      const session = makeSession();
      // Use a real session manager so end-to-end counting works
      const { SessionManager } = await import('../session.js');
      const mockTmux = { listWindows: vi.fn().mockResolvedValue([]), listPanePid: vi.fn().mockResolvedValue(null) };
      const mockConfig = { stateDir: '/tmp/cb-env-test', defaultPermissionMode: 'default', defaultSessionEnv: {} };
      const sm = new (SessionManager as unknown as new (...args: unknown[]) => InstanceType<typeof SessionManager>)(mockTmux, mockConfig);
      const stateObj = (sm as unknown as Record<string, unknown>).state as { sessions: Record<string, SessionInfo> };
      stateObj.sessions[SESSION_ID] = session;

      // Import hooks AFTER setting the env var so the module constant is correct
      const { registerHookRoutes } = await import('../hooks.js');
      app = Fastify({ logger: false });
      eventBus = new SessionEventBus();
      registerHookRoutes(app, { sessions: sm as unknown as SessionManager, eventBus });

      const emitted: string[] = [];
      eventBus.subscribe(SESSION_ID, (e) => emitted.push(e.event));

      // 2 failures — below threshold of 3
      for (let i = 0; i < 2; i++) {
        const r = await app.inject({
          method: 'POST',
          url: `/v1/hooks/StopFailure?sessionId=${SESSION_ID}`,
          payload: {},
        });
        expect(r.statusCode).toBe(200);
      }
      await flushAsync();
      expect(emitted.filter(e => e === 'circuit_breaker')).toHaveLength(0);

      // 3rd failure trips the circuit breaker
      const r = await app.inject({
        method: 'POST',
        url: `/v1/hooks/StopFailure?sessionId=${SESSION_ID}`,
        payload: {},
      });
      await flushAsync();
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ ok: true });
      expect(emitted.filter(e => e === 'circuit_breaker')).toHaveLength(1);
    } finally {
      if (originalMax === undefined) delete process.env.HOOK_CIRCUIT_BREAKER_MAX;
      else process.env.HOOK_CIRCUIT_BREAKER_MAX = originalMax;
    }
  });
});
