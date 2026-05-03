/**
 * hooksecret-strip.test.ts — Tests for Issue #2527.
 *
 * hookSecret must never appear in API responses.
 */

import { describe, it, expect } from 'vitest';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = '00000000-0000-0000-0000-000000002527';

function makeSession(): SessionInfo {
  return {
    id: SESSION_ID,
    windowId: '@2527',
    windowName: 'secret-test',
    workDir: '/tmp/secret-test',
    claudeSessionId: 'cc-123',
    jsonlPath: '/tmp/test.jsonl',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    hookSecret: 'deadbeef64charhexstringsecretthatshouldnotleak1234567890',
    hookSettingsFile: '/tmp/hooks-test.json',
    ccPid: 12345,
    tenantId: '_system',
  };
}

describe('hookSecret stripped from API responses (Issue #2527)', () => {
  it('stripSensitiveFields removes hookSecret', () => {
    const session = makeSession();
    const public_ = SessionManager.stripSensitiveFields(session);
    expect(public_.hookSecret).toBeUndefined();
  });

  it('stripSensitiveFields removes jsonlPath', () => {
    const session = makeSession();
    const public_ = SessionManager.stripSensitiveFields(session);
    expect(public_.jsonlPath).toBeUndefined();
  });

  it('stripSensitiveFields removes hookSettingsFile', () => {
    const session = makeSession();
    const public_ = SessionManager.stripSensitiveFields(session);
    expect(public_.hookSettingsFile).toBeUndefined();
  });

  it('stripSensitiveFields removes ccPid', () => {
    const session = makeSession();
    const public_ = SessionManager.stripSensitiveFields(session);
    expect((public_ as any).ccPid).toBeUndefined();
  });

  it('stripSensitiveFields preserves public fields', () => {
    const session = makeSession();
    const public_ = SessionManager.stripSensitiveFields(session);
    expect(public_.id).toBe(SESSION_ID);
    expect(public_.windowId).toBe('@2527');
    expect(public_.status).toBe('idle');
    expect(public_.workDir).toBe('/tmp/secret-test');
    expect(public_.createdAt).toBe(session.createdAt);
    expect(public_.tenantId).toBe('_system');
  });

  it('stripSensitiveFieldsList strips all sessions', () => {
    const sessions = [makeSession(), makeSession()];
    const public_ = SessionManager.stripSensitiveFieldsList(sessions);
    expect(public_).toHaveLength(2);
    for (const s of public_) {
      expect(s.hookSecret).toBeUndefined();
      expect(s.jsonlPath).toBeUndefined();
    }
  });

  it('original session is not mutated', () => {
    const session = makeSession();
    SessionManager.stripSensitiveFields(session);
    expect(session.hookSecret).toBe('deadbeef64charhexstringsecretthatshouldnotleak1234567890');
    expect(session.jsonlPath).toBe('/tmp/test.jsonl');
  });

  it('session without sensitive fields still works', () => {
    const session: SessionInfo = {
      id: SESSION_ID,
      windowId: '@2527',
      windowName: 'test',
      workDir: '/tmp',
      byteOffset: 0,
      monitorOffset: 0,
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 300_000,
      permissionStallMs: 300_000,
      permissionMode: 'default',
    };
    const public_ = SessionManager.stripSensitiveFields(session);
    expect(public_.id).toBe(SESSION_ID);
    expect(public_.status).toBe('idle');
  });
});
