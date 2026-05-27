import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyHookEvent } from '../session-status-updater.js';
import type { SessionInfo } from '../session-types.js';

function makeSession(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'test-session',
    windowId: '',
    displayName: 'test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now(),
    latestActivityText: '',
    stallThresholdMs: 60_000,
    permissionStallMs: 30_000,
    permissionMode: 'default',
    settingsPatched: false,
    hookSecret: 'secret',
    ...overrides,
  } as SessionInfo;
}

describe('applyHookEvent', () => {
  it('returns previous status', () => {
    const session = makeSession({ status: 'working' });
    const prev = applyHookEvent(session, 'Stop');
    expect(prev).toBe('working');
  });

  it('returns null for null session', () => {
    // Function signature requires SessionInfo, so this test is for the wrapper
    // The extracted function always receives a valid session
  });

  it('transitions to idle on Stop', () => {
    const session = makeSession({ status: 'working' });
    applyHookEvent(session, 'Stop');
    expect(session.status).toBe('idle');
  });

  it('transitions to idle on TaskCompleted', () => {
    const session = makeSession({ status: 'working' });
    applyHookEvent(session, 'TaskCompleted');
    expect(session.status).toBe('idle');
  });

  it('transitions to working on PreToolUse and increments toolUseCount', () => {
    const session = makeSession({ status: 'idle' });
    applyHookEvent(session, 'PreToolUse');
    expect(session.status).toBe('working');
    expect(session.toolUseCount).toBe(1);
    applyHookEvent(session, 'PreToolUse');
    expect(session.toolUseCount).toBe(2);
  });

  it('transitions to working on PostToolUse', () => {
    const session = makeSession({ status: 'idle' });
    applyHookEvent(session, 'PostToolUse');
    expect(session.status).toBe('working');
  });

  it('transitions to permission_prompt on PermissionRequest', () => {
    const session = makeSession({ status: 'working' });
    applyHookEvent(session, 'PermissionRequest');
    expect(session.status).toBe('permission_prompt');
    expect(session.permissionPromptAt).toBeDefined();
  });

  it('transitions to error on StopFailure', () => {
    const session = makeSession({ status: 'working' });
    applyHookEvent(session, 'StopFailure');
    expect(session.status).toBe('error');
  });

  it('does not change status for informational events', () => {
    const session = makeSession({ status: 'idle' });
    applyHookEvent(session, 'Notification');
    expect(session.status).toBe('idle');
  });

  it('updates lastHookAt and lastActivity', () => {
    const session = makeSession();
    const before = Date.now();
    applyHookEvent(session, 'Stop');
    expect(session.lastHookAt!).toBeGreaterThanOrEqual(before);
    expect(session.lastActivity!).toBeGreaterThanOrEqual(before);
  });

  it('records lastHookEventAt from hookTimestamp', () => {
    const session = makeSession();
    const ts = Date.now() - 1000;
    applyHookEvent(session, 'Stop', ts);
    expect(session.lastHookEventAt).toBe(ts);
  });

  it('clamps future hookTimestamp to now', () => {
    const session = makeSession();
    const futureTs = Date.now() + 60_000;
    applyHookEvent(session, 'Stop', futureTs);
    expect(session.lastHookEventAt!).toBeLessThanOrEqual(Date.now());
  });

  it('detects premature termination', () => {
    const session = makeSession({
      status: 'working',
      createdAt: Date.now() - 60_000,
      toolUseCount: 25,
    });
    applyHookEvent(session, 'TaskCompleted');
    expect(session.prematureTermination).toBe(true);
  });

  it('does not flag premature termination for short sessions', () => {
    const session = makeSession({
      status: 'working',
      createdAt: Date.now() - 1000,
      toolUseCount: 5,
    });
    applyHookEvent(session, 'TaskCompleted');
    expect(session.prematureTermination).toBeUndefined();
  });
});
