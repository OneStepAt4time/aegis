/**
 * stall-recovery-3752.test.ts — Tests for Issue #3752: CC mid-session hang auto-recovery.
 *
 * Verifies:
 * 1. Config defaults for stall recovery
 * 2. attemptStallRecovery calls restartSession via retryWithJitter
 * 3. Recovery skipped when disabled
 * 4. Recovery skipped when no acpBackend
 * 5. Recovery skipped when already recovering (prevents double-recovery)
 * 6. Recovery cleans up tracking on success and failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { ChannelManager, SessionEventPayload } from '../channels/index.js';
import type { AcpBackend } from '../services/acp/backend.js';
import { SYSTEM_TENANT } from '../config.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-stall-1',
    windowId: 'win-1',
    displayName: 'stalled-session',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'working',
    createdAt: Date.now(),
    lastActivity: Date.now() - 300_000, // 5 min ago
    stallThresholdMs: 120_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    tenantId: SYSTEM_TENANT,
    ownerKeyId: 'master',
    ...overrides,
  } as SessionInfo;
}

function makeSessionManager(sessions: SessionInfo[]): SessionManager {
  return {
    listSessions: () => sessions,
    getSession: (id: string) => sessions.find(s => s.id === id) ?? null,
  } as unknown as SessionManager;
}

function makeChannels(): ChannelManager & { payloads: SessionEventPayload[] } {
  const payloads: SessionEventPayload[] = [];
  return {
    payloads,
    statusChange: vi.fn(async (p: SessionEventPayload) => { payloads.push(p); }),
  } as unknown as ChannelManager & { payloads: SessionEventPayload[] };
}

function makeAcpBackend(fail = false) {
  const restartSession = vi.fn(async () => {
    if (fail) throw new Error('Restart failed');
    return { backendRunId: 'run-recover-1', status: 'started' as const, backoffDelayMs: 500 };
  });
  return {
    backend: { restartSession } as unknown as AcpBackend,
    restartSession,
  };
}

function createMonitor(
  sessions: SessionInfo[],
  channels: ReturnType<typeof makeChannels>,
  acpBackend?: AcpBackend,
  configOverrides: Record<string, unknown> = {},
) {
  const mon = new SessionMonitor(
    makeSessionManager(sessions),
    channels,
    { ...DEFAULT_MONITOR_CONFIG, deadCheckIntervalMs: 1_000_000, stallCheckIntervalMs: 1_000_000, ...configOverrides },
  );
  if (acpBackend) mon.setAcpBackend(acpBackend);
  return mon;
}

describe('Issue #3752: Stall auto-recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('has correct config defaults', () => {
    expect(DEFAULT_MONITOR_CONFIG.stallRecoveryEnabled).toBe(true);
    expect(DEFAULT_MONITOR_CONFIG.stallRecoveryMaxRetries).toBe(1);
  });

  it('calls restartSession on stall recovery', async () => {
    const session = makeSession();
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor([session], channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');

    // Advance timers to let retryWithJitter complete
    await vi.runAllTimersAsync();

    expect(acp.restartSession).toHaveBeenCalledTimes(1);
    expect(acp.restartSession).toHaveBeenCalledWith({
      sessionId: 'sess-stall-1',
      cwd: '/tmp/test',
      tenantId: SYSTEM_TENANT,
      ownerKeyId: 'master',
      reason: 'stall_recovery_jsonl',
    });
  });

  it('notifies user about recovery attempt', async () => {
    const session = makeSession();
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor([session], channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');

    // The immediate notification should be sent
    expect(channels.payloads.length).toBeGreaterThanOrEqual(1);
    expect(channels.payloads[0].detail).toContain('stall recovery');
  });

  it('skips recovery when disabled', async () => {
    const session = makeSession();
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor([session], channels, acp.backend, { stallRecoveryEnabled: false });

    mon.attemptStallRecovery(session, 'jsonl');

    await vi.runAllTimersAsync();

    expect(acp.restartSession).not.toHaveBeenCalled();
    expect(channels.payloads).toHaveLength(0);
  });

  it('skips recovery when no acpBackend', async () => {
    const session = makeSession();
    const channels = makeChannels();
    const mon = createMonitor([session], channels); // No acpBackend

    mon.attemptStallRecovery(session, 'jsonl');

    await vi.runAllTimersAsync();

    expect(channels.payloads).toHaveLength(0);
  });

  it('prevents double-recovery for same session', async () => {
    const session = makeSession();
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor([session], channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');
    mon.attemptStallRecovery(session, 'extended_working'); // Should be skipped

    await vi.runAllTimersAsync();

    // Only one restart should happen
    expect(acp.restartSession).toHaveBeenCalledTimes(1);
  });

  it('cleans up tracking on failure and allows retry', async () => {
    const session = makeSession();
    const channels = makeChannels();
    const acp = makeAcpBackend(true); // Always fails
    const mon = createMonitor([session], channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();

    // Recovery failed, tracking should be cleaned up
    // Second call should be allowed (not blocked by stale tracking)
    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();

    // Two attempts should have been made
    expect(acp.restartSession).toHaveBeenCalledTimes(2);
  });

  it('sends failure notification when recovery fails', async () => {
    const session = makeSession();
    const channels = makeChannels();
    const acp = makeAcpBackend(true);
    const mon = createMonitor([session], channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();

    const lastPayload = channels.payloads[channels.payloads.length - 1];
    expect(lastPayload.detail).toContain('recovery failed');
  });
});
