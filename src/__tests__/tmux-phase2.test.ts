/**
 * tmux-phase2.test.ts — Phase 2 unit tests for tmux.ts methods.
 * Issue #1880: tmux.ts unit tests Phase 2
 * 
 * Tests the testable surface of TmuxManager that doesn't require
 * mocking the private `tmux` internal method:
 * - isTmuxServerError (public error classification)
 * - isPidAlive (public pid check — delegates to platform)
 * - TmuxTimeoutError (exported error class)
 *
 * Note: Methods that require the private `tmux` internal method
 * (capturePane, sendSpecialKey, listPanePid, getWindowHealth, windowExists)
 * are covered by integration tests in:
 * - tmux-crash-recovery.test.ts
 * - tmux-polling-395.test.ts  
 * - tmux-race-403.test.ts
 * - tmux-queue-recovery-1615.test.ts
 */

import { describe, it, expect } from 'vitest';
import { TmuxManager, TmuxTimeoutError } from '../tmux.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(overrides?: { sessionName?: string; socketName?: string }) {
  const manager = Object.create(TmuxManager.prototype);
  manager.sessionName = overrides?.sessionName ?? 'test-session';
  manager.socketName = overrides?.socketName ?? 'test';
  manager.windowCache = new Map();
  manager._creatingCount = 0;
  return manager as unknown as TmuxManager;
}

// ---------------------------------------------------------------------------
// isTmuxServerError — error classification (public method)
// ---------------------------------------------------------------------------

describe('isTmuxServerError', () => {
  it('classifies connection refused as tmux server error', () => {
    const manager = makeManager();
    const error = new Error('connection refused');
    expect(manager.isTmuxServerError(error)).toBe(true);
  });

  it('classifies no server running as tmux server error', () => {
    const manager = makeManager();
    const error = new Error('no server running');
    expect(manager.isTmuxServerError(error)).toBe(true);
  });

  it('classifies failed to connect as tmux server error', () => {
    const manager = makeManager();
    const error = new Error('failed to connect to server');
    expect(manager.isTmuxServerError(error)).toBe(true);
  });

  it('classifies no tmux server as tmux server error', () => {
    const manager = makeManager();
    const error = new Error('no tmux server');
    expect(manager.isTmuxServerError(error)).toBe(true);
  });

  it('returns false for generic errors', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('some other error'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError('not an error')).toBe(false);
    expect(manager.isTmuxServerError(null)).toBe(false);
    expect(manager.isTmuxServerError({ code: 'ENOENT' })).toBe(false);
    expect(manager.isTmuxServerError(undefined)).toBe(false);
  });

  it('is case insensitive', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('CONNECTION REFUSED'))).toBe(true);
    expect(manager.isTmuxServerError(new Error('No Server Running'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPidAlive — delegates to platform abstraction (public method)
// ---------------------------------------------------------------------------

describe('isPidAlive', () => {
  it('returns a boolean for pid 1 (init on Unix)', () => {
    const manager = makeManager();
    const result = manager.isPidAlive(1);
    expect(typeof result).toBe('boolean');
  });

  it('returns boolean for any integer pid', () => {
    const manager = makeManager();
    const result = manager.isPidAlive(12345);
    expect(typeof result).toBe('boolean');
  });

  it('returns a boolean for a very large pid', () => {
    const manager = makeManager();
    const result = manager.isPidAlive(999999999);
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// TmuxTimeoutError — exported error class
// ---------------------------------------------------------------------------

describe('TmuxTimeoutError', () => {
  it('has correct name', () => {
    const err = new TmuxTimeoutError(['send-keys', '-t', 'aegis:@1'], 10_000);
    expect(err.name).toBe('TmuxTimeoutError');
  });

  it('includes command in message', () => {
    const err = new TmuxTimeoutError(['capture-pane', '-t', '@1', '-p'], 5_000);
    expect(err.message).toContain('capture-pane');
    expect(err.message).toContain('@1');
  });

  it('includes timeout in message', () => {
    const err = new TmuxTimeoutError(['send-keys', '-t', '@1'], 30_000);
    expect(err.message).toContain('30000');
  });

  it('is an instance of Error', () => {
    const err = new TmuxTimeoutError(['list-windows'], 10_000);
    expect(err instanceof Error).toBe(true);
  });

  it('can be thrown and caught', () => {
    expect(() => {
      throw new TmuxTimeoutError(['send-keys', '-t', '@1', '-l', 'hello'], 10_000);
    }).toThrow(TmuxTimeoutError);
  });
});
