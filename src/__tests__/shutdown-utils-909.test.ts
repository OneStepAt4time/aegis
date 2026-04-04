import { describe, it, expect } from 'vitest';
import { isWindowsShutdownMessage, parseShutdownTimeoutMs } from '../shutdown-utils.js';

describe('Issue #909: shutdown timeout parsing', () => {
  it('uses configured timeout when valid', () => {
    expect(parseShutdownTimeoutMs('25000')).toBe(25_000);
  });

  it('falls back for invalid or too-small values', () => {
    expect(parseShutdownTimeoutMs('abc')).toBe(15_000);
    expect(parseShutdownTimeoutMs('500')).toBe(15_000);
  });
});

describe('Issue #909: Windows shutdown message detection', () => {
  it('accepts known string shutdown messages', () => {
    expect(isWindowsShutdownMessage('shutdown')).toBe(true);
    expect(isWindowsShutdownMessage('graceful-shutdown')).toBe(true);
  });

  it('accepts typed message payload shutdown events', () => {
    expect(isWindowsShutdownMessage({ type: 'shutdown' })).toBe(true);
    expect(isWindowsShutdownMessage({ type: 'graceful-shutdown' })).toBe(true);
  });

  it('rejects unrelated messages', () => {
    expect(isWindowsShutdownMessage('reload')).toBe(false);
    expect(isWindowsShutdownMessage({ type: 'ping' })).toBe(false);
    expect(isWindowsShutdownMessage({})).toBe(false);
  });
});
