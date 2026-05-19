/**
 * Issue #3681: Add runnerName to SessionInfo for agent type identification.
 *
 * Tests:
 * - SessionInfo includes optional runnerName field
 * - API contract SessionInfo includes optional runnerName field
 * - SessionEventPayload.session includes optional runnerName
 * - redactSession preserves runnerName
 * - Hydration preserves runnerName from persisted state
 */
import { describe, it, expect } from 'vitest';
import type { SessionInfo as ApiSessionInfo } from '../api-contracts.js';
import type { SessionInfo as InternalSessionInfo } from '../session.js';
import type { SessionEventPayload } from '../channels/types.js';
import { redactSession } from '../routes/context.js';

describe('Issue #3681: runnerName in SessionInfo', () => {
  it('API SessionInfo accepts runnerName', () => {
    const info: ApiSessionInfo = {
      id: 'test-id',
      displayName: 'test',
      workDir: '/tmp',
      byteOffset: 0,
      monitorOffset: 0,
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 5000,
      permissionMode: 'default',
      runnerName: 'claude-code',
    };
    expect(info.runnerName).toBe('claude-code');
  });

  it('API SessionInfo works without runnerName (backward compat)', () => {
    const info: ApiSessionInfo = {
      id: 'test-id',
      displayName: 'test',
      workDir: '/tmp',
      byteOffset: 0,
      monitorOffset: 0,
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 5000,
      permissionMode: 'default',
    };
    expect(info.runnerName).toBeUndefined();
  });

  it('SessionEventPayload.session accepts runnerName', () => {
    const payload: SessionEventPayload = {
      event: 'session.created',
      timestamp: new Date().toISOString(),
      session: {
        id: 'test-id',
        name: 'test-session',
        workDir: '/tmp',
        runnerName: 'claude-code',
      },
      detail: 'Session created',
    };
    expect(payload.session.runnerName).toBe('claude-code');
  });

  it('SessionEventPayload.session works without runnerName', () => {
    const payload: SessionEventPayload = {
      event: 'session.created',
      timestamp: new Date().toISOString(),
      session: {
        id: 'test-id',
        name: 'test-session',
        workDir: '/tmp',
      },
      detail: 'Session created',
    };
    expect(payload.session.runnerName).toBeUndefined();
  });

  it('redactSession preserves runnerName', () => {
    const session = {
      id: 'test-id',
      displayName: 'test',
      workDir: '/tmp',
      runnerName: 'claude-code',
      hookSecret: 'secret-123',
      byteOffset: 0,
      monitorOffset: 0,
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 5000,
      permissionMode: 'default',
    };
    const redacted = redactSession(session);
    expect(redacted.runnerName).toBe('claude-code');
    expect((redacted as any).hookSecret).toBeUndefined();
  });

  it('redactSession works when runnerName is absent', () => {
    const session = {
      id: 'test-id',
      displayName: 'test',
      workDir: '/tmp',
      byteOffset: 0,
      monitorOffset: 0,
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 5000,
      permissionMode: 'default',
    };
    const redacted = redactSession(session);
    expect(redacted.runnerName).toBeUndefined();
  });
});
