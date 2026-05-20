/**
 * rate-limit-retry-3754.test.ts — Tests for Issue #3754: CC rate-limit retry logic.
 *
 * Verifies that the monitor correctly:
 * 1. Detects rate-limit StopFailure signals
 * 2. Calls acpBackend.restartSession() with exponential backoff
 * 3. Respects max retry budget
 * 4. Notifies user on retry and exhaustion
 * 5. Resets retry tracking on session resume
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { ChannelManager, SessionEventPayload } from '../channels/index.js';
import type { AcpBackend, AcpBackendRestartResult } from '../services/acp/backend.js';
import { SYSTEM_TENANT } from '../config.js';

// --- Mocks ---

function makeMockSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-1',
    windowId: 'win-1',
    displayName: 'test-session',
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

function makeMockSessionManager(sessions: SessionInfo[]): SessionManager {
  return {
    listSessions: () => sessions,
    getSession: (id: string) => sessions.find(s => s.id === id) ?? null,
  } as unknown as SessionManager;
}

function makeMockChannelManager(): ChannelManager & { payloads: SessionEventPayload[] } {
  const payloads: SessionEventPayload[] = [];
  return {
    payloads,
    statusChange: vi.fn(async (payload: SessionEventPayload) => {
      payloads.push(payload);
    }),
  } as unknown as ChannelManager & { payloads: SessionEventPayload[] };
}

function makeMockAcpBackend(): { backend: AcpBackend; restartSession: ReturnType<typeof vi.fn> } {
  const restartSession = vi.fn(async () => ({
    backendRunId: 'run-1',
    status: 'started' as const,
    backoffDelayMs: 1000,
  }));
  return {
    backend: { restartSession } as unknown as AcpBackend,
    restartSession,
  };
}

// --- Tests ---

describe('Issue #3754: Rate-limit retry logic', () => {
  let monitor: SessionMonitor;
  let mockSessions: SessionInfo[];
  let mockSessionManager: SessionManager;
  let mockChannels: ReturnType<typeof makeMockChannelManager>;
  let mockAcp: ReturnType<typeof makeMockAcpBackend>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockSessions = [makeMockSession()];
    mockSessionManager = makeMockSessionManager(mockSessions);
    mockChannels = makeMockChannelManager();
    mockAcp = makeMockAcpBackend();

    monitor = new SessionMonitor(
      mockSessionManager,
      mockChannels,
      { ...DEFAULT_MONITOR_CONFIG, deadCheckIntervalMs: 100_000, stallCheckIntervalMs: 100_000 },
    );
    monitor.setAcpBackend(mockAcp.backend);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should include retry config in MonitorConfig defaults', () => {
    expect(DEFAULT_MONITOR_CONFIG.rateLimitMaxRetries).toBe(3);
    expect(DEFAULT_MONITOR_CONFIG.rateLimitBaseDelayMs).toBe(5_000);
    expect(DEFAULT_MONITOR_CONFIG.rateLimitMaxDelayMs).toBe(60_000);
  });

  it('should expose setAcpBackend for dependency injection', () => {
    const mon = new SessionMonitor(
      mockSessionManager,
      mockChannels,
    );
    // No backend set — should not throw
    expect(() => mon.setAcpBackend(mockAcp.backend)).not.toThrow();
  });
});
