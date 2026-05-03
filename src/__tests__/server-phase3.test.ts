/**
 * server-phase3.test.ts — Phase 3 unit tests for server.ts internals.
 *
 * Covers: timingSafeEqual edge cases, checkIpRateLimit, checkAuthFailRateLimit,
 * recordAuthFailure, pruneAuthFailLimits, reapStaleSessions, reapZombieSessions.
 *
 * Follows the mock pattern from server-core-coverage.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

import { createMockTmuxManager } from './helpers/mock-tmux.js';

const sandboxRoot = join(process.cwd(), '.test-scratch', `server-phase3-${crypto.randomUUID()}`);
const stateDir = join(sandboxRoot, 'state');
const projectsDir = join(sandboxRoot, 'projects');
const workDir = join(sandboxRoot, 'workdir');

const originalEnv: Record<string, string | undefined> = {
  AEGIS_STATE_DIR: process.env.AEGIS_STATE_DIR,
  AEGIS_CLAUDE_PROJECTS_DIR: process.env.AEGIS_CLAUDE_PROJECTS_DIR,
  AEGIS_PORT: process.env.AEGIS_PORT,
  AEGIS_HOST: process.env.AEGIS_HOST,
  AEGIS_AUTH_TOKEN: process.env.AEGIS_AUTH_TOKEN,
  AEGIS_ALLOWED_WORK_DIRS: process.env.AEGIS_ALLOWED_WORK_DIRS,
};

const authToken = 'phase3-test-token';
const authHeaders = { authorization: `Bearer ${authToken}` };

let capturedApp: FastifyInstance | null = null;

// ── Spyable RateLimiter mock ────────────────────────────────────────
const rateLimiterSpies = {
  checkIpRateLimit: vi.fn<(ip: string, isMaster: boolean, keyId?: string) => boolean>(() => false),
  checkIpRateLimitUnauth: vi.fn<(ip: string) => boolean>(() => false),
  checkAuthFailRateLimit: vi.fn<(ip: string) => boolean>(() => false),
  recordAuthFailure: vi.fn<(ip: string) => void>(),
  pruneAuthFailLimits: vi.fn<() => void>(),
  pruneIpRateLimits: vi.fn<() => void>(),
  dispose: vi.fn<() => void>(),
};

vi.mock('../services/auth/RateLimiter.js', () => ({
  RateLimiter: class {
    checkIpRateLimit = rateLimiterSpies.checkIpRateLimit;
    checkIpRateLimitUnauth = rateLimiterSpies.checkIpRateLimitUnauth;
    checkAuthFailRateLimit = rateLimiterSpies.checkAuthFailRateLimit;
    recordAuthFailure = rateLimiterSpies.recordAuthFailure;
    pruneAuthFailLimits = rateLimiterSpies.pruneAuthFailLimits;
    pruneIpRateLimits = rateLimiterSpies.pruneIpRateLimits;
    dispose = rateLimiterSpies.dispose;
  },
}));

vi.mock('../startup.js', () => ({
  listenWithRetry: vi.fn(async (app: FastifyInstance) => {
    capturedApp = app;
    await app.ready();
  }),
  writePidFile: vi.fn(async () => join(stateDir, 'aegis.pid')),
  removePidFile: vi.fn(),
}));

vi.mock('../pipeline.js', () => ({
  PipelineManager: class {
    async hydrate(): Promise<void> {}
    async destroy(): Promise<void> {}
  },
}));

// Capture setInterval callbacks so reapers can be invoked manually
const capturedIntervalCallbacks: Array<{ callback: (...args: unknown[]) => void; ms: number }> = [];

vi.mock('../tmux.js', () => ({
  TmuxManager: class {
    constructor() {
      return createMockTmuxManager();
    }
  },
}));

function authed(options: InjectOptions) {
  return capturedApp!.inject({
    ...options,
    headers: {
      ...authHeaders,
      ...(typeof options.headers === 'object' && options.headers !== null ? options.headers : {}),
    },
  });
}

// Shared session for hook tests — created once, reused across the describe
let sharedHookSessionId: string;

describe('server.ts Phase 3 — internal functions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(workDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(projectsDir, { recursive: true });

    process.env.AEGIS_STATE_DIR = stateDir;
    process.env.AEGIS_CLAUDE_PROJECTS_DIR = projectsDir;
    process.env.AEGIS_PORT = '19101';
    process.env.AEGIS_HOST = '127.0.0.1';
    process.env.AEGIS_AUTH_TOKEN = authToken;
    process.env.AEGIS_ALLOWED_WORK_DIRS = sandboxRoot;

    // Capture interval callbacks instead of discarding them
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((cb: (...args: unknown[]) => void, ms?: number) => {
      capturedIntervalCallbacks.push({ callback: cb, ms: ms ?? 0 });
      return capturedIntervalCallbacks.length as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation((() => undefined) as unknown as typeof clearInterval);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await import('../server.js');

    // Wait for app capture
    for (let i = 0; i < 200 && !capturedApp; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (!capturedApp) throw new Error('server app was not captured');
    app = capturedApp;

    // Create one shared session for hook auth tests
    const created = await authed({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir, name: 'hook-shared', permissionMode: 'bypassPermissions', claudeCommand: 'claude --print' },
    });
    expect(created.statusCode).toBe(201);
    sharedHookSessionId = created.json().id as string;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    rateLimiterSpies.checkIpRateLimit.mockClear();
    rateLimiterSpies.checkIpRateLimit.mockReturnValue(false);
    rateLimiterSpies.checkAuthFailRateLimit.mockClear();
    rateLimiterSpies.checkAuthFailRateLimit.mockReturnValue(false);
    rateLimiterSpies.recordAuthFailure.mockClear();
    rateLimiterSpies.pruneAuthFailLimits.mockClear();
    rateLimiterSpies.pruneIpRateLimits.mockClear();
  });

  // ── timingSafeEqual edge cases ────────────────────────────────────
  describe('timingSafeEqual (via hook auth)', () => {
    it('rejects hook with missing secret', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/stop?sessionId=${sharedHookSessionId}`,
        payload: { stop_reason: 'done' },
      });
      // No X-Hook-Secret header and no ?secret= query → 401
      expect(res.statusCode).toBe(401);
    });

    it('rejects hook with empty string secret', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/stop?sessionId=${sharedHookSessionId}`,
        headers: { 'x-hook-secret': '' },
        payload: { stop_reason: 'done' },
      });
      // timingSafeEqual('', session.hookSecret) → false (empty string is falsy)
      expect(res.statusCode).toBe(401);
    });

    it('rejects hook with wrong secret (different string)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/stop?sessionId=${sharedHookSessionId}`,
        headers: { 'x-hook-secret': 'definitely-wrong-secret' },
        payload: { stop_reason: 'done' },
      });
      // timingSafeEqual('definitely-wrong-secret', hookSecret) → false
      expect(res.statusCode).toBe(401);
    });

    it('rejects hook with non-UUID session id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/stop?sessionId=not-a-uuid',
        payload: { stop_reason: 'done' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects hook with unknown session id even if secret provided', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/stop?sessionId=${fakeId}`,
        headers: { 'x-hook-secret': 'any-secret' },
        payload: { stop_reason: 'done' },
      });
      // Session doesn't exist → falls through to blanket 401
      expect(res.statusCode).toBe(401);
    });
  });

  // ── checkIpRateLimit ──────────────────────────────────────────────
  describe('checkIpRateLimit', () => {
    it('delegates to rateLimiter on authenticated requests', async () => {
      const res = await authed({ method: 'GET', url: '/v1/sessions' });
      expect(res.statusCode).toBe(200);

      const calls = rateLimiterSpies.checkIpRateLimit.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // First arg is the IP (string), second is the master flag (boolean)
      expect(typeof calls[0]![0]).toBe('string');
      expect(typeof calls[0]![1]).toBe('boolean');
    });

    it('returns 429 when IP is rate limited', async () => {
      rateLimiterSpies.checkIpRateLimit.mockReturnValue(true);

      const res = await authed({ method: 'GET', url: '/v1/sessions' });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toMatch(/rate limit/i);
    });

    it('isMaster=true for master auth token', async () => {
      await authed({ method: 'GET', url: '/v1/sessions' });
      const calls = rateLimiterSpies.checkIpRateLimit.mock.calls;
      // The master token should pass isMaster=true
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toBeDefined();
      expect(lastCall![1]).toBe(true);
    });
  });

  // ── checkAuthFailRateLimit ─────────────────────────────────────────
  describe('checkAuthFailRateLimit', () => {
    // #2456: checkAuthFailRateLimit is now only called on failed auth,
    // not on every authenticated request. Valid tokens are never blocked
    // by prior auth failures from the same IP.
    it('is not called for valid tokens — only on auth failure paths', async () => {
      await authed({ method: 'GET', url: '/v1/sessions' });
      expect(rateLimiterSpies.checkAuthFailRateLimit).not.toHaveBeenCalled();
    });

    it('returns 429 when auth fail rate limit is exceeded on invalid token', async () => {
      rateLimiterSpies.checkAuthFailRateLimit.mockReturnValue(true);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: 'Bearer invalid-token' },
      });
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toMatch(/too many auth failures/i);
    });

    it('allows valid request regardless of auth fail rate limit state', async () => {
      rateLimiterSpies.checkAuthFailRateLimit.mockReturnValue(true);

      // Valid token should succeed even when auth-fail limit is exceeded
      const res = await authed({ method: 'GET', url: '/v1/sessions' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── recordAuthFailure ─────────────────────────────────────────────
  describe('recordAuthFailure', () => {
    it('records failure when an invalid token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: 'Bearer invalid-token' },
      });
      expect(res.statusCode).toBe(401);
      expect(rateLimiterSpies.recordAuthFailure).toHaveBeenCalled();
      // Verify IP was passed
      const calls = rateLimiterSpies.recordAuthFailure.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(typeof calls[0]![0]).toBe('string');
    });

    it('does not record failure for valid token', async () => {
      await authed({ method: 'GET', url: '/v1/sessions' });
      expect(rateLimiterSpies.recordAuthFailure).not.toHaveBeenCalled();
    });

    it('records failure once per request via recordAuthFailureOnce dedup', async () => {
      // Send two separate requests with invalid tokens
      await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: 'Bearer bad-token-1' },
      });
      const firstCount = rateLimiterSpies.recordAuthFailure.mock.calls.length;

      await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: 'Bearer bad-token-2' },
      });
      const secondCount = rateLimiterSpies.recordAuthFailure.mock.calls.length;

      // Each request should increment the call count by exactly 1
      // (recordAuthFailureOnce deduplicates within a single request)
      expect(secondCount).toBe(firstCount + 1);
    });
  });

  // ── pruneAuthFailLimits ───────────────────────────────────────────
  describe('pruneAuthFailLimits', () => {
    it('prune interval is registered at 60s', () => {
      const sixtySecIntervals = capturedIntervalCallbacks.filter(({ ms }) => ms === 60_000);
      expect(sixtySecIntervals.length).toBeGreaterThanOrEqual(1);
    });

    it('invoking the 60s interval callback triggers pruneAuthFailLimits', () => {
      const sixtySecIntervals = capturedIntervalCallbacks.filter(({ ms }) => ms === 60_000);
      for (const { callback } of sixtySecIntervals) {
        callback();
      }
      // pruneAuthFailLimits and pruneIpRateLimits both run on 60s intervals
      expect(rateLimiterSpies.pruneAuthFailLimits).toHaveBeenCalled();
    });
  });

  // ── reapStaleSessions ─────────────────────────────────────────────
  describe('reapStaleSessions', () => {
    it('stale session reaper is registered via setInterval', () => {
      // Multiple intervals should be registered (reaper, zombie reaper, prune, metrics)
      expect(capturedIntervalCallbacks.length).toBeGreaterThanOrEqual(3);
    });

    it('stale reaper does not kill fresh sessions', { timeout: 15_000 }, async () => {
      const created = await authed({
        method: 'POST',
        url: '/v1/sessions',
        payload: { workDir, name: 'fresh-session', permissionMode: 'bypassPermissions', claudeCommand: 'claude --print' },
      });
      expect(created.statusCode).toBe(201);
      const freshId = created.json().id as string;

      // Invoke all captured interval callbacks — fresh sessions should survive
      for (const { callback } of capturedIntervalCallbacks) {
        callback();
      }

      const check = await authed({ method: 'GET', url: `/v1/sessions/${freshId}` });
      expect(check.statusCode).toBe(200);

      // Clean up
      await authed({ method: 'DELETE', url: `/v1/sessions/${freshId}` });
    });
  });

  // ── reapZombieSessions ────────────────────────────────────────────
  describe('reapZombieSessions', () => {
    it('zombie reaper interval is registered', () => {
      // At least the reaper + zombie reaper + prune intervals
      expect(capturedIntervalCallbacks.length).toBeGreaterThanOrEqual(3);
    });

    it('zombie reaper does not kill active sessions', { timeout: 15_000 }, async () => {
      const created = await authed({
        method: 'POST',
        url: '/v1/sessions',
        payload: { workDir, name: 'active-session', permissionMode: 'bypassPermissions', claudeCommand: 'claude --print' },
      });
      expect(created.statusCode).toBe(201);
      const activeId = created.json().id as string;

      // Invoke all captured interval callbacks — active sessions (no lastDeadAt) survive
      for (const { callback } of capturedIntervalCallbacks) {
        callback();
      }

      const check = await authed({ method: 'GET', url: `/v1/sessions/${activeId}` });
      expect(check.statusCode).toBe(200);

      // Clean up
      await authed({ method: 'DELETE', url: `/v1/sessions/${activeId}` });
    });
  });
});
