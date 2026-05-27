/**
 * Tests for session-hook-circuit-breaker.ts
 * Issue #4246: Hook failure circuit breaker extraction.
 */
import { describe, it, expect } from 'vitest';
import { recordHookFailure, recordHookSuccess, checkHookCircuitBreaker } from '../session-hook-circuit-breaker.js';
import type { SessionInfo } from '../session-types.js';

function makeSession(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'test-session',
    windowId: '',
    displayName: 'Test',
    workDir: '/tmp',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'working',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  } as SessionInfo;
}

describe('session-hook-circuit-breaker', () => {
  describe('recordHookFailure', () => {
    it('initializes hookFailureTimestamps if missing', () => {
      const session = makeSession();
      expect(session.hookFailureTimestamps).toBeUndefined();
      recordHookFailure(session);
      expect(session.hookFailureTimestamps).toHaveLength(1);
    });

    it('appends timestamp to existing array', () => {
      const session = makeSession({ hookFailureTimestamps: [1000] });
      recordHookFailure(session);
      expect(session.hookFailureTimestamps).toHaveLength(2);
      expect(session.hookFailureTimestamps![0]).toBe(1000);
    });

    it('records multiple failures', () => {
      const session = makeSession();
      recordHookFailure(session);
      recordHookFailure(session);
      recordHookFailure(session);
      expect(session.hookFailureTimestamps).toHaveLength(3);
    });
  });

  describe('recordHookSuccess', () => {
    it('clears failure timestamps and resets breaker', () => {
      const session = makeSession({
        hookFailureTimestamps: [1000, 2000, 3000],
        circuitBreakerTripped: true,
      });
      recordHookSuccess(session);
      expect(session.hookFailureTimestamps).toEqual([]);
      expect(session.circuitBreakerTripped).toBe(false);
    });

    it('is safe to call on a clean session', () => {
      const session = makeSession();
      recordHookSuccess(session);
      expect(session.hookFailureTimestamps).toEqual([]);
      expect(session.circuitBreakerTripped).toBe(false);
    });
  });

  describe('checkHookCircuitBreaker', () => {
    it('returns false when no failures recorded', () => {
      const session = makeSession();
      expect(checkHookCircuitBreaker(session, 3, 60_000)).toBe(false);
    });

    it('returns false when failures are within limit', () => {
      const now = Date.now();
      const session = makeSession({
        hookFailureTimestamps: [now - 1000, now - 500],
      });
      expect(checkHookCircuitBreaker(session, 3, 60_000)).toBe(false);
    });

    it('trips when failures reach the threshold', () => {
      const now = Date.now();
      const session = makeSession({
        hookFailureTimestamps: [now - 2000, now - 1000, now],
      });
      expect(checkHookCircuitBreaker(session, 3, 60_000)).toBe(true);
      expect(session.circuitBreakerTripped).toBe(true);
    });

    it('stays tripped once tripped', () => {
      const session = makeSession({
        circuitBreakerTripped: true,
        hookFailureTimestamps: [],
      });
      expect(checkHookCircuitBreaker(session, 5, 60_000)).toBe(true);
    });

    it('prunes timestamps outside the window', () => {
      const now = Date.now();
      const session = makeSession({
        hookFailureTimestamps: [now - 120_000, now - 110_000, now - 1000],
      });
      // Only 1 timestamp is within the 60_000ms window
      expect(checkHookCircuitBreaker(session, 3, 60_000)).toBe(false);
      // The old timestamps should have been pruned
      expect(session.hookFailureTimestamps).toHaveLength(1);
    });

    it('handles undefined hookFailureTimestamps', () => {
      const session = makeSession();
      expect(checkHookCircuitBreaker(session, 1, 60_000)).toBe(false);
    });

    it('trips at exactly maxFailures', () => {
      const now = Date.now();
      const session = makeSession({
        hookFailureTimestamps: [now, now],
      });
      expect(checkHookCircuitBreaker(session, 2, 60_000)).toBe(true);
    });
  });
});
