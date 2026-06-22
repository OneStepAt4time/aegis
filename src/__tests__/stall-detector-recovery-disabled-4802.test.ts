/**
 * stall-detector-recovery-disabled-4802.test.ts — Issue #4802 (Themis F-4).
 *
 * Per-session kill-switch for stall auto-recovery. Operator who wants to pause
 * recovery for a specific session (e.g. debugging, manual intervention in flight)
 * must have a lever. Currently `stallRecoveryEnabled` is GLOBAL only — no
 * per-session disable. Themis finding F-4:
 *
 *   "Without per-session disable, 'recovers without operator action' can
 *    become 'recovers even after operator said stop' — same family as the
 *    original 529 bug, just inverted."
 *
 * Required behavior after this PR:
 * 1. SessionInfo gains `recoveryDisabled?: boolean` (default false)
 * 2. attemptStallRecovery skips when session.recoveryDisabled === true
 * 3. attemptStallRecovery still fires when session.recoveryDisabled is unset or false
 * 4. The kill-switch is independent of the global stallRecoveryEnabled flag
 * 5. A log/audit event is emitted when recovery is skipped due to kill-switch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { ChannelManager, SessionEventPayload } from '../channels/index.js';
import type { AcpBackend } from '../services/acp/backend.js';
import { SYSTEM_TENANT } from '../config.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-killswitch-1',
    windowId: 'win-1',
    displayName: 'kill-switch-test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'working',
    createdAt: Date.now(),
    lastActivity: Date.now(),
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

function makeAcpBackend() {
  const restartSession = vi.fn(async () => ({
    backendRunId: 'run-recover-1',
    status: 'started' as const,
    backoffDelayMs: 500,
  }));
  return {
    backend: { restartSession } as unknown as AcpBackend,
    restartSession,
  };
}

function createMonitor(channels: ReturnType<typeof makeChannels>, acpBackend?: AcpBackend) {
  const mon = new SessionMonitor(
    makeSessionManager([]),
    channels,
    { ...DEFAULT_MONITOR_CONFIG, deadCheckIntervalMs: 1_000_000, stallCheckIntervalMs: 1_000_000 },
  );
  if (acpBackend) mon.setAcpBackend(acpBackend);
  return mon;
}

describe('Issue #4802 (F-4): per-session recoveryDisabled kill-switch', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('does NOT call restartSession when session.recoveryDisabled === true', async () => {
    const session = makeSession({ recoveryDisabled: true });
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor(channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();

    expect(acp.restartSession).not.toHaveBeenCalled();
  });

  it('DOES call restartSession when session.recoveryDisabled === false', async () => {
    const session = makeSession({ recoveryDisabled: false });
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor(channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();

    expect(acp.restartSession).toHaveBeenCalledTimes(1);
  });

  it('DOES call restartSession when session.recoveryDisabled is unset (back-compat)', async () => {
    const session = makeSession(); // no recoveryDisabled
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor(channels, acp.backend);

    mon.attemptStallRecovery(session, 'extended_working');
    await vi.runAllTimersAsync();

    expect(acp.restartSession).toHaveBeenCalledTimes(1);
  });

  it('emits an audit log/notification when recovery is skipped by kill-switch', async () => {
    const session = makeSession({ recoveryDisabled: true });
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor(channels, acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();

    // Must surface the kill-switch state to the operator — not silently swallow
    const killSwitchPayload = channels.payloads.find(p =>
      typeof p.detail === 'string' && /recovery.{0,20}(disabled|paused|skipped)/i.test(p.detail)
    );
    expect(killSwitchPayload).toBeDefined();
  });

  it('does not block the second attempt — kill-switch is per-call, not sticky', async () => {
    const session = makeSession({ recoveryDisabled: true });
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = createMonitor(channels, acp.backend);

    // First attempt: kill-switch on, skipped
    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();
    expect(acp.restartSession).not.toHaveBeenCalled();

    // Operator flips kill-switch off — second attempt should fire
    session.recoveryDisabled = false;
    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();
    expect(acp.restartSession).toHaveBeenCalledTimes(1);
  });

  it('kill-switch is independent of global stallRecoveryEnabled flag', async () => {
    // Even when global flag is OFF (already a no-op), the kill-switch check is
    // a separate gate. When global is ON but per-session is OFF, recovery skips.
    const session = makeSession({ recoveryDisabled: true });
    const channels = makeChannels();
    const acp = makeAcpBackend();
    const mon = new SessionMonitor(
      makeSessionManager([]),
      channels,
      {
        ...DEFAULT_MONITOR_CONFIG,
        stallRecoveryEnabled: true, // global ON
        deadCheckIntervalMs: 1_000_000,
        stallCheckIntervalMs: 1_000_000,
      },
    );
    mon.setAcpBackend(acp.backend);

    mon.attemptStallRecovery(session, 'jsonl');
    await vi.runAllTimersAsync();

    // Per-session kill-switch wins over global enabled
    expect(acp.restartSession).not.toHaveBeenCalled();
  });
});
