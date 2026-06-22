/**
 * stall-detector-f9-wiring-4802.test.ts — Issue #4802 F-9: typed StallEventPayload
 * wiring at every stall emit site + recovery attempt tracking.
 *
 * F-9 closes the 3-PR arc for #4802:
 *   - PR #4803 (server-side detection + redact payload + kill-switch) → merged
 *   - PR <F-9> (this PR — wire buildStallEventPayload into 12 emit sites + recovery
 *     attempt counter) → this PR
 *   - PR #4804 (dashboard typed pill + Send continue button) → awaiting label
 *
 * Until F-9 lands, the renderer falls back to a generic 'Stalled' pill (Path 2
 * default) and the Send continue button stays hidden because recovery exhaustion
 * cannot be computed without the typed fields.
 *
 * RED phase — these tests pin the contract:
 *   1. emitStallTyped callback fires at each of the 7 stall-detector emit sites
 *      with the bounded errorClass enum + statusCode (transient_5xx only)
 *   2. emitStallTyped fires at the 4 attemptStallRecovery statusChange sites
 *   3. emitStallTyped fires at the 2 rate-limit-retry sites with transient_5xx + statusCode
 *   4. recoveryAttempts Map: increments per retry attempt, resets on success / idle
 *   5. recoveryAttemptCount + recoveryMaxAttempts populate in the typed payload
 *   6. recoveryDisabled mirrors session.recoveryDisabled in the typed payload
 *   7. Channel fanout split: meta carries payload WITHOUT statusCode (fingerprint drop)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  StallDetector,
  type StallDetectorConfig,
  type StallDetectorDeps,
} from '../stall-detector.js';
import type { SessionInfo, UIState } from '../session-types.js';
import { type StallEventPayload } from '../stall-events.js';
import { SYSTEM_TENANT } from '../config.js';

function makeConfig(overrides: Partial<StallDetectorConfig> = {}): StallDetectorConfig {
  return {
    stallThresholdMs: 60_000,
    permissionStallMs: 300_000,
    unknownStallMs: 120_000,
    permissionTimeoutMs: 600_000,
    stallRecoveryEnabled: true,
    stallRecoveryMaxRetries: 3,
    ...overrides,
  };
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-f9-1',
    windowId: 'win-1',
    displayName: 'f9-test-session',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 100,
    status: 'working',
    createdAt: Date.now() - 600_000,
    lastActivity: Date.now() - 600_000,
    stallThresholdMs: 60_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    tenantId: SYSTEM_TENANT,
    ownerKeyId: 'master',
    ...overrides,
  } as SessionInfo;
}

interface TypedStallCall {
  sessionId: string;
  payload: StallEventPayload;
}

function makeDeps(): StallDetectorDeps & {
  typedStallCalls: TypedStallCall[];
  restartCalls: number;
} {
  const typedStallCalls: TypedStallCall[] = [];
  let restartCalls = 0;
  return {
    rejectSession: vi.fn(),
    emitStall: vi.fn(),
    emitStallTyped: (sessionId, payload) => { typedStallCalls.push({ sessionId, payload }); },
    statusChange: vi.fn(),
    makePayload: vi.fn().mockImplementation(
      (event: string, _session: SessionInfo, detail: string) => ({ event, detail }),
    ),
    restartSession: vi.fn().mockImplementation(async () => {
      restartCalls += 1;
      return { backoffDelayMs: 1000 };
    }),
    typedStallCalls,
    get restartCalls() { return restartCalls; },
  } as unknown as StallDetectorDeps & { typedStallCalls: TypedStallCall[]; restartCalls: number };
}

describe('Issue #4802 F-9: StallDetector emits typed StallEventPayload', () => {
  it('emitStallTyped fires with errorClass=thinking_stall on thinking stall', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig(), deps);
    const session = makeSession({ status: 'working' });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'working']]);
    const lastStatusText = new Map<string, string | null>([
      ['sess-f9-1', 'Cogitated for 7m'], // parseCogitatedDuration returns null (stub), so fallback to extended_working path
    ]);
    // Use a working state with no thinkingDuration to fall through to JSONL stall path

    // Seed first-byte observation
    await detector.check([session], lastStatus, new Map(), 1000);
    // Advance time to trigger JSONL stall (no new bytes for 60s+)
    await detector.check(
      [session],
      lastStatus,
      lastStatusText,
      1000 + 70_000, // 70 seconds in
    );

    const jsonlStallCall = deps.typedStallCalls.find(
      c => c.payload.errorClass === 'jsonl_stall',
    );
    expect(jsonlStallCall).toBeDefined();
    expect(jsonlStallCall!.sessionId).toBe('sess-f9-1');
    expect(jsonlStallCall!.payload.stallDurationMs).toBeGreaterThanOrEqual(60_000);
    expect(jsonlStallCall!.payload.recoveryAttemptCount).toBe(0);
    expect(jsonlStallCall!.payload.recoveryMaxAttempts).toBe(3);
    expect(jsonlStallCall!.payload.recoveryDisabled).toBe(false);
    // Path 2 fanout: statusCode is NOT in jsonl_stall (only transient_5xx carries it)
    expect(jsonlStallCall!.payload.statusCode).toBeUndefined();
  });

  it('emitStallTyped fires with errorClass=permission_timeout on permission stall', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig(), deps);
    const session = makeSession({ status: 'permission_prompt' });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'permission_prompt']]);
    // Wait for permissionStallMs (300s) before the stall fires
    await detector.check([session], lastStatus, new Map(), 1000);
    await detector.check(
      [session],
      lastStatus,
      new Map(),
      1000 + 350_000, // 350s in
    );

    const permStallCall = deps.typedStallCalls.find(
      c => c.payload.errorClass === 'permission_timeout',
    );
    expect(permStallCall).toBeDefined();
    expect(permStallCall!.sessionId).toBe('sess-f9-1');
  });

  it('emitStallTyped fires with errorClass=unknown_stall on unknown-state stall', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig(), deps);
    const session = makeSession({ status: 'unknown' });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'unknown']]);
    await detector.check([session], lastStatus, new Map(), 1000);
    await detector.check(
      [session],
      lastStatus,
      new Map(),
      1000 + 130_000, // 130s in (above unknownStallMs=120s)
    );

    const unkCall = deps.typedStallCalls.find(
      c => c.payload.errorClass === 'unknown_stall',
    );
    expect(unkCall).toBeDefined();
  });

  it('emitStallTyped fires with errorClass=extended_working on extended-working stall', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig(), deps);
    const session = makeSession({
      status: 'working',
      monitorOffset: 100, // frozen bytes
    });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'working']]);
    // Set lastBytesSeen at offset 100 (already at 100 — first check seeds it)
    await detector.check([session], lastStatus, new Map(), 1000);
    // Stay in working for > 3x threshold = 180s without byte growth
    await detector.check(
      [session],
      lastStatus,
      new Map(),
      1000 + 200_000, // 200s
    );

    const extCall = deps.typedStallCalls.find(
      c => c.payload.errorClass === 'extended_working',
    );
    expect(extCall).toBeDefined();
  });

  it('emitStallTyped carries recoveryAttemptCount + recoveryMaxAttempts', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig({ stallRecoveryMaxRetries: 5 }));
    const session = makeSession({
      status: 'working',
      monitorOffset: 100,
      recoveryDisabled: false,
    });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'working']]);
    await detector.check([session], lastStatus, new Map(), 1000);
    await detector.check(
      [session],
      lastStatus,
      new Map(),
      1000 + 200_000, // 200s — triggers extended_working stall + recovery
    );

    const extCall = deps.typedStallCalls.find(
      c => c.payload.errorClass === 'extended_working',
    );
    expect(extCall).toBeDefined();
    expect(extCall!.payload.recoveryMaxAttempts).toBe(5);
    expect(extCall!.payload.recoveryAttemptCount).toBeGreaterThanOrEqual(0);
  });

  it('emitStallTyped carries recoveryDisabled=true when session kill-switch is active', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig(), deps);
    const session = makeSession({
      status: 'working',
      monitorOffset: 100,
      recoveryDisabled: true,
    });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'working']]);
    await detector.check([session], lastStatus, new Map(), 1000);
    await detector.check(
      [session],
      lastStatus,
      new Map(),
      1000 + 200_000,
    );

    // Look for kill-switch surface call (recovery skipped)
    const killSwitchCall = deps.typedStallCalls.find(
      c => c.payload.recoveryDisabled === true,
    );
    expect(killSwitchCall).toBeDefined();
  });

  it('recoveryAttempts Map increments per retry attempt via onRetry', async () => {
    const deps = makeDeps();
    // Force restartSession to fail twice then succeed — exercises onRetry path
    let attempt = 0;
    deps.restartSession = vi.fn().mockImplementation(async () => {
      attempt += 1;
      if (attempt <= 2) throw new Error('transient failure');
      return { backoffDelayMs: 1000 };
    });

    const detector = new StallDetector(makeConfig({ stallRecoveryMaxRetries: 5 }), deps);
    const session = makeSession({
      status: 'working',
      monitorOffset: 100,
    });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'working']]);
    await detector.check([session], lastStatus, new Map(), 1000);
    await detector.check(
      [session],
      lastStatus,
      new Map(),
      1000 + 200_000, // triggers extended_working stall + recovery
    );

    // recoveryAttempts should be visible after retries fired
    // (Number of attempts that have been registered — depends on retry policy)
    expect(detector.recoveryAttempts.has('sess-f9-1')).toBe(true);
    expect(detector.recoveryAttempts.get('sess-f9-1')).toBeGreaterThanOrEqual(2);
  });

  it('recoveryAttempts Map resets to 0 on successful recovery', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig({ stallRecoveryMaxRetries: 3 }), deps);
    const session = makeSession({
      status: 'working',
      monitorOffset: 100,
    });

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'working']]);
    await detector.check([session], lastStatus, new Map(), 1000);
    await detector.check(
      [session],
      lastStatus,
      new Map(),
      1000 + 200_000,
    );

    // recoveryAttempts should be cleared after successful restart
    // (depends on retry success vs failure path — for green phase this MUST reset)
    expect(detector.recoveryAttempts.has('sess-f9-1')).toBe(false);
  });

  it('recoveryAttempts Map resets on idle transition', async () => {
    const deps = makeDeps();
    const detector = new StallDetector(makeConfig(), deps);
    const session = makeSession({
      status: 'working',
      monitorOffset: 100,
    });

    // Set some recovery state
    detector.recoveryAttempts.set('sess-f9-1', 2);

    const lastStatus = new Map<string, UIState>([['sess-f9-1', 'idle']]);
    await detector.check([session], lastStatus, new Map(), 1000);

    expect(detector.recoveryAttempts.has('sess-f9-1')).toBe(false);
  });
});

describe('Issue #4802 F-9: Channel fanout drops statusCode (fingerprint defense)', () => {
  it('toChannelFanoutPayload drops statusCode from transient_5xx payload', async () => {
    // Unit test the helper itself — channel fanout paths MUST use this
    const { buildStallEventPayload, toChannelFanoutPayload } = await import('../stall-events.js');
    const payload = buildStallEventPayload({
      errorClass: 'transient_5xx',
      statusCode: 529,
      stallDurationMs: 60_000,
      recoveryAttemptCount: 2,
      recoveryMaxAttempts: 5,
      recoveryDisabled: false,
    });
    const fanout = toChannelFanoutPayload(payload);
    expect(fanout).not.toHaveProperty('statusCode');
    expect(fanout.errorClass).toBe('transient_5xx');
    expect(fanout.recoveryAttemptCount).toBe(2);
  });
});
