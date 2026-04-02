/**
 * suppress-882.test.ts — Tests for the explicit suppression predicate.
 *
 * Issue #882: Verifies that:
 * 1. Expected transient races are suppressed (no warn, only debug)
 * 2. Unexpected exceptions surface a visible warning
 * 3. Rate limiting suppresses debug noise beyond the per-minute cap
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSuppressible, suppressedCatch, _resetSuppressRateLimit } from '../suppress.js';

beforeEach(() => {
  _resetSuppressRateLimit();
  vi.restoreAllMocks();
});

describe('isSuppressible', () => {
  it('suppresses session-not-found messages', () => {
    expect(isSuppressible(new Error('session not found'), 'monitor.checkSession')).toBe(true);
    expect(isSuppressible(new Error('No session with id abc123'), 'monitor.checkSession')).toBe(true);
  });

  it('suppresses ENOENT (file removed after session kill)', () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    expect(isSuppressible(err, 'monitor.checkSession')).toBe(true);
  });

  it('suppresses tmux pane/window-gone errors', () => {
    expect(isSuppressible(new Error("tmux: can't find window"), 'tmux.capturePane')).toBe(true);
    expect(isSuppressible(new Error('no such pane: %42'), 'tmux.capturePane')).toBe(true);
    expect(isSuppressible(new Error('no such window'), 'tmux.capturePane')).toBe(true);
    expect(isSuppressible(new Error('window already dead'), 'monitor.checkDeadSessions.killSession')).toBe(true);
  });

  it('suppresses SyntaxError (truncated JSONL reads)', () => {
    expect(isSuppressible(new SyntaxError('Unexpected end of JSON'), 'monitor.checkStopSignals.parseEntry')).toBe(true);
  });

  it('does NOT suppress generic internal errors', () => {
    expect(isSuppressible(new Error('Something totally unexpected'), 'monitor.checkSession')).toBe(false);
    expect(isSuppressible(new TypeError('Cannot read property x of undefined'), 'monitor.checkSession')).toBe(false);
  });
});

describe('suppressedCatch', () => {
  it('emits console.debug (not warn) for suppressible errors', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    suppressedCatch(new Error('session not found'), 'monitor.checkSession');

    expect(debug).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(debug.mock.calls[0][0]).toContain('[suppress] monitor.checkSession');
  });

  it('emits console.warn for non-suppressible errors', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    suppressedCatch(new TypeError('unexpected internal failure'), 'monitor.checkSession');

    expect(warn).toHaveBeenCalledOnce();
    expect(debug).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('[unexpected] monitor.checkSession');
  });

  it('rate-limits debug output beyond SUPPRESS_MAX_PER_MINUTE', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const err = new Error('session not found');
    for (let i = 0; i < 20; i++) {
      suppressedCatch(err, 'monitor.checkSession');
    }

    // Should stop at 10, not emit all 20
    expect(debug.mock.calls.length).toBe(10);
  });
});
