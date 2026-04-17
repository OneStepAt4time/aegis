import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionRequestManager } from '../permission-request-manager.js';

describe('PermissionRequestManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes countdown metadata for pending permissions', async () => {
    const manager = new PermissionRequestManager();
    const startedAt = Date.now();
    const decision = manager.waitForPermissionDecision('sess-1', 10_000, 'Bash', 'npm run deploy');

    expect(manager.getPendingPermissionInfo('sess-1')).toEqual({
      toolName: 'Bash',
      prompt: 'npm run deploy',
      startedAt,
      timeoutMs: 10_000,
      expiresAt: startedAt + 10_000,
      remainingMs: 10_000,
    });

    vi.advanceTimersByTime(2_500);

    expect(manager.getPendingPermissionInfo('sess-1')?.remainingMs).toBe(7_500);
    expect(manager.resolvePendingPermission('sess-1', 'allow')).toBe(true);
    await expect(decision).resolves.toBe('allow');
    expect(manager.getPendingPermissionInfo('sess-1')).toBeNull();
  });
});
