/**
 * hooksecret-redaction-2527.test.ts — Verify hookSecret is never exposed in API responses.
 *
 * Issue #2527: hookSecret (HMAC secret for hook URL auth) must be stripped from
 * all session API responses. Any API key holder reading session data should not
 * be able to forge hook payloads.
 */

import { describe, it, expect } from 'vitest';
import { redactSession } from '../routes/context.js';

describe('redactSession — Issue #2527', () => {
  it('strips hookSecret from session object', () => {
    const session = {
      id: '11111111-1111-1111-1111-111111111111',
      windowId: '@1',
      workDir: '/home/user/repo',
      status: 'idle',
      hookSecret: 'dead54222855e0eeb2e60e3027423d907a755e8dff416f0b630c2c2c3eece4fd',
      hookSettingsFile: '/tmp/aegis-hook-settings-123',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    const redacted = redactSession(session);
    expect(redacted).not.toHaveProperty('hookSecret');
    expect(redacted).not.toHaveProperty('hookSettingsFile');
    // Non-sensitive fields preserved
    expect(redacted.id).toBe(session.id);
    expect(redacted.workDir).toBe(session.workDir);
    expect(redacted.status).toBe(session.status);
  });

  it('preserves all non-sensitive fields', () => {
    const session = {
      id: '22222222-2222-2222-2222-222222222222',
      windowName: 'test-session',
      workDir: '/home/user/project',
      status: 'working',
      model: 'claude-sonnet-4-20250514',
      ownerKeyId: 'key-abc',
      parentId: '33333333-3333-3333-3333-333333333333',
      children: ['44444444-4444-4444-4444-444444444444'],
      hookSecret: 'super-secret-hex-value',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    const redacted = redactSession(session);
    expect(redacted.id).toBe('22222222-2222-2222-2222-222222222222');
    expect(redacted.windowName).toBe('test-session');
    expect(redacted.model).toBe('claude-sonnet-4-20250514');
    expect(redacted.ownerKeyId).toBe('key-abc');
    expect(redacted.parentId).toBe('33333333-3333-3333-3333-333333333333');
    expect(redacted.children).toEqual(['44444444-4444-4444-4444-444444444444']);
    expect(redacted).not.toHaveProperty('hookSecret');
  });

  it('handles session without hookSecret gracefully', () => {
    const session = {
      id: '55555555-5555-5555-5555-555555555555',
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    const redacted = redactSession(session);
    expect(redacted.id).toBe('55555555-5555-5555-5555-555555555555');
  });

  it('converts activeSubagents Set to array', () => {
    const session = {
      id: '66666666-6666-6666-6666-666666666666',
      status: 'idle',
      activeSubagents: new Set(['sub-a', 'sub-b']),
      hookSecret: 'should-be-stripped',
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    const redacted = redactSession(session);
    expect(redacted).not.toHaveProperty('hookSecret');
    expect(Array.isArray(redacted.activeSubagents)).toBe(true);
    expect(redacted.activeSubagents).toEqual(['sub-a', 'sub-b']);
  });
});
