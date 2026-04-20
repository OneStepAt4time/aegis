/**
 * suppress-timeouts.test.ts — Tests for TmuxTimeoutError suppression.
 *
 * Verifies that timeouts during non-critical tmux read operations
 * (capture-pane, list-windows, monitor.checkSession) are suppressible,
 * while timeouts during critical operations are not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isSuppressible, suppressedCatch, _resetSuppressRateLimit } from '../suppress.js';
import { TmuxTimeoutError } from '../tmux.js';

beforeEach(() => {
  _resetSuppressRateLimit();
  vi.restoreAllMocks();
});

describe('isSuppressible — TmuxTimeoutError', () => {
  it('suppresses TmuxTimeoutError on tmux.capturePane', () => {
    const err = new TmuxTimeoutError(['capture-pane', '-t', 'sess'], 10_000);
    expect(isSuppressible(err, 'tmux.capturePane')).toBe(true);
  });

  it('suppresses TmuxTimeoutError on tmux.listWindows', () => {
    const err = new TmuxTimeoutError(['list-windows', '-t', 'sess'], 10_000);
    expect(isSuppressible(err, 'tmux.listWindows')).toBe(true);
  });

  it('suppresses TmuxTimeoutError on monitor.checkSession', () => {
    const err = new TmuxTimeoutError(['capture-pane', '-t', 'sess'], 10_000);
    expect(isSuppressible(err, 'monitor.checkSession')).toBe(true);
  });

  it('does NOT suppress TmuxTimeoutError on critical contexts', () => {
    const err = new TmuxTimeoutError(['send-keys', '-t', 'sess', 'C-c'], 10_000);
    expect(isSuppressible(err, 'tmux.sendKeys')).toBe(false);
  });

  it('does NOT suppress TmuxTimeoutError on monitor.checkDeadSessions.killSession', () => {
    const err = new TmuxTimeoutError(['kill-session', '-t', 'sess'], 10_000);
    expect(isSuppressible(err, 'monitor.checkDeadSessions.killSession')).toBe(false);
  });

  it('does NOT suppress TmuxTimeoutError on session.cleanup', () => {
    const err = new TmuxTimeoutError(['kill-session', '-t', 'sess'], 10_000);
    expect(isSuppressible(err, 'session.cleanup')).toBe(false);
  });

  it('does NOT suppress TmuxTimeoutError on unknown tmux context', () => {
    const err = new TmuxTimeoutError(['new-session', '-d'], 10_000);
    expect(isSuppressible(err, 'tmux.newSession')).toBe(false);
  });
});

describe('suppressedCatch — TmuxTimeoutError', () => {
  it('emits console.debug for non-critical timeout', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const err = new TmuxTimeoutError(['capture-pane', '-t', 'sess'], 10_000);
    suppressedCatch(err, 'tmux.capturePane');

    expect(debug).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(debug.mock.calls[0][0]).toContain('[suppress] tmux.capturePane');
    expect(debug.mock.calls[0][0]).toContain('timed out');
  });

  it('emits console.warn for critical timeout', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const err = new TmuxTimeoutError(['send-keys', '-t', 'sess', 'msg'], 10_000);
    suppressedCatch(err, 'tmux.sendKeys');

    expect(warn).toHaveBeenCalledOnce();
    expect(debug).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toContain('[unexpected] tmux.sendKeys');
  });

  it('rate-limits suppressed timeout debug events', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const err = new TmuxTimeoutError(['capture-pane', '-t', 'sess'], 10_000);
    for (let i = 0; i < 20; i++) {
      suppressedCatch(err, 'tmux.capturePane');
    }

    expect(debug.mock.calls.length).toBe(10);
  });
});
