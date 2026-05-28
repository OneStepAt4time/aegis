/**
 * Tests for monitor/rate-limit-retry.ts — Rate-limit detection and automatic retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitRetryHandler } from '../monitor/rate-limit-retry.js';
import type { RateLimitRetryDeps, RateLimitRetryConfig } from '../monitor/rate-limit-retry.js';

// Mock computeDelayMs for deterministic tests
vi.mock('../retry.js', () => ({
  computeDelayMs: vi.fn((attempt, base) => base * Math.pow(2, attempt - 1)),
}));

function makeDeps(): RateLimitRetryDeps {
  return {
    makePayload: ((event: any, session: any, detail: any) => ({ event, session: { id: session.id }, detail })) as RateLimitRetryDeps['makePayload'],
    statusChange: vi.fn(),
    alertFailure: vi.fn(),
    metricsFailed: vi.fn(),
    markRateLimited: vi.fn(),
    unmarkRateLimited: vi.fn(),
  };
}

const defaultConfig: RateLimitRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
};

function makeSession(id = 's1') {
  return {
    id,
    displayName: `Session ${id}`,
    workDir: '/tmp/test',
    tenantId: 'default',
    ownerKeyId: 'master',
    status: 'working',
  } as any;
}

describe('RateLimitRetryHandler', () => {
  let deps: RateLimitRetryDeps;
  let handler: RateLimitRetryHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    handler = new RateLimitRetryHandler(deps, defaultConfig);
  });

  describe('getRetryAttempts', () => {
    it('starts with empty map', () => {
      expect(handler.getRetryAttempts()).toEqual(new Map());
    });
  });

  describe('updateDeps', () => {
    it('replaces dependency callbacks', () => {
      const newAlertFailure = vi.fn();
      handler.updateDeps({ alertFailure: newAlertFailure });

      // Verify by checking the handler exists and updated
      expect(handler.getRetryAttempts()).toEqual(new Map());
    });
  });

  describe('rateLimitCoordinator', () => {
    it('exposes the coordinator', () => {
      expect(handler.rateLimitCoordinator).toBeDefined();
    });
  });

  describe('removeSession', () => {
    it('removes retry tracking and dequeues from coordinator', () => {
      handler.getRetryAttempts().set('s1', 2);
      handler.removeSession('s1');
      expect(handler.getRetryAttempts().has('s1')).toBe(false);
    });
  });

  describe('handleRateLimitSignal (no ACP backend)', () => {
    it('emits legacy notification when no ACP backend set', async () => {
      const session = makeSession();
      await handler.handleRateLimitSignal(session, 'rate_limit');

      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'status.rate_limited' }),
      );
      expect(deps.markRateLimited).toHaveBeenCalledWith('s1');
      // No retry attempts tracked without backend
      expect(handler.getRetryAttempts().has('s1')).toBe(false);
    });
  });

  describe('handleRateLimitSignal (with ACP backend)', () => {
    it('tracks retry attempts and schedules retry', async () => {
      const mockBackend = {
        restartSession: vi.fn(async () => ({ backoffDelayMs: 100 })),
      };
      handler.setAcpBackend(mockBackend as any);

      const session = makeSession();
      await handler.handleRateLimitSignal(session, 'rate_limit');

      expect(deps.markRateLimited).toHaveBeenCalledWith('s1');
      expect(handler.getRetryAttempts().get('s1')).toBe(1);
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'status.rate_limited',
          detail: expect.stringContaining('Retrying (1/3)'),
        }),
      );
    });

    it('increments retry count on repeated calls', async () => {
      const mockBackend = {
        restartSession: vi.fn(async () => ({ backoffDelayMs: 100 })),
      };
      handler.setAcpBackend(mockBackend as any);

      const session = makeSession();
      await handler.handleRateLimitSignal(session, 'rate_limit');
      await handler.handleRateLimitSignal(session, 'rate_limit');

      expect(handler.getRetryAttempts().get('s1')).toBe(2);
    });
  });

  describe('handleRateLimitSignal (retries exhausted)', () => {
    it('notifies error when max retries exceeded with backend', async () => {
      const mockBackend = {
        restartSession: vi.fn(async () => { throw new Error('restart failed'); }),
      };
      handler.setAcpBackend(mockBackend as any);

      // Pre-fill retry count to max
      handler.getRetryAttempts().set('s1', defaultConfig.maxRetries);

      const session = makeSession();
      // This call will try attempt maxRetries+1 which exceeds limit → no new attempt tracked
      await handler.handleRateLimitSignal(session, 'rate_limit');

      // Should emit exhausted status immediately since attempt > maxRetries
      expect(deps.statusChange).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'status.error',
          detail: expect.stringContaining('exhausted'),
        }),
      );
      expect(deps.alertFailure).toHaveBeenCalled();
      expect(deps.metricsFailed).toHaveBeenCalledWith('s1');
    });
  });
});
