/**
 * suppress-timeouts.test.ts — Tests for legacy timeout error suppression.
 *
 * Verifies that timeouts during non-critical read operations
 * (monitor.checkSession) are suppressible, while timeouts during
 * critical operations are not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSuppressible, suppressedCatch, _resetSuppressRateLimit } from '../suppress.js';

/** Local stand-in for legacy timeout error classes. */
class LegacyTimeoutError extends Error {
  constructor(public readonly args: string[], public readonly timeoutMs: number) {
    super(`command [${args.join(' ')}] timed out after ${timeoutMs}ms`);
    this.name = 'TmuxTimeoutError';
  }
}


beforeEach(() => {
  _resetSuppressRateLimit();
  vi.restoreAllMocks();
});

describe('isSuppressible — LegacyTimeoutError', () => {
  it('suppresses LegacyTimeoutError on monitor.checkSession', () => {
    const err = new LegacyTimeoutError(['check-session'], 10_000);
    expect(isSuppressible(err, 'monitor.checkSession')).toBe(true);
  });

  it('does NOT suppress LegacyTimeoutError on critical contexts', () => {
    const err = new LegacyTimeoutError(['send-message'], 10_000);
    expect(isSuppressible(err, 'session.sendMessage')).toBe(false);
  });

  it('does NOT suppress LegacyTimeoutError on monitor.checkDeadSessions.killSession', () => {
    const err = new LegacyTimeoutError(['kill-session'], 10_000);
    expect(isSuppressible(err, 'monitor.checkDeadSessions.killSession')).toBe(false);
  });

  it('does NOT suppress LegacyTimeoutError on session.cleanup', () => {
    const err = new LegacyTimeoutError(['cleanup'], 10_000);
    expect(isSuppressible(err, 'session.cleanup')).toBe(false);
  });

  it('does NOT suppress LegacyTimeoutError on unknown context', () => {
    const err = new LegacyTimeoutError(['new-session'], 10_000);
    expect(isSuppressible(err, 'runtime.newSession')).toBe(false);
  });
});

describe('suppressedCatch — LegacyTimeoutError', () => {
  it('emits console.debug for non-critical timeout', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const err = new LegacyTimeoutError(['check-session'], 10_000);
    suppressedCatch(err, 'monitor.checkSession');

    expect(debug).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(debug.mock.calls[0][0]).toContain('[suppress] monitor.checkSession');
    expect(debug.mock.calls[0][0]).toContain('timed out');
  });

  it('emits console.warn for critical timeout', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const err = new LegacyTimeoutError(['send-message'], 10_000);
    suppressedCatch(err, 'session.sendMessage');

    expect(warn).toHaveBeenCalledOnce();
    expect(debug).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('[unexpected] session.sendMessage');
  });

  it('rate-limits suppressed timeout debug events', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const err = new LegacyTimeoutError(['check-session'], 10_000);
    for (let i = 0; i < 20; i++) {
      suppressedCatch(err, 'monitor.checkSession');
    }

    expect(debug.mock.calls.length).toBe(10);
  });
});
