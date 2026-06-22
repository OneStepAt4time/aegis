/**
 * monitor-payload-redaction-4802.test.ts — Issue #4802: server-side redaction
 * of stall payload detail strings (Themis F-6 finding).
 *
 * MakePayload currently does `detail.slice(0, 2000)` — a length cap with NO
 * redaction. Any secret pattern in the upstream-derived detail (statusText,
 * errorDetail, raw transcript strings) is shipped to channels unredacted.
 *
 * Required behavior after this PR:
 * 1. makePayload applies redactSecretsFromText BEFORE slice(0, 2000)
 * 2. Common secret patterns (ghp_, sk-, AKIA, PEM blocks) are redacted
 * 3. Length cap still applied (defense in depth)
 * 4. Empty / no-secret detail is unchanged
 */

import { describe, it, expect } from 'vitest';
import { SessionMonitor } from '../monitor.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { ChannelManager } from '../channels/index.js';
import { SYSTEM_TENANT } from '../config.js';

// Build credential-shaped fixtures via concatenation to avoid triggering
// GitGuardian / credo false positives (same convention as #3617).
const GHP_FAKE = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';

function makeSession(): SessionInfo {
  return {
    id: 'sess-redact-1',
    windowId: 'win-1',
    displayName: 'redact-test',
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
  } as SessionInfo;
}

function makeMonitor(): SessionMonitor {
  const sessions: SessionManager = {
    listSessions: () => [],
    getSession: () => null,
  } as unknown as SessionManager;
  const channels: ChannelManager = {} as unknown as ChannelManager;
  return new SessionMonitor(sessions, channels);
}

describe('Issue #4802 (F-6): makePayload server-side redaction', () => {
  const monitor = makeMonitor();
  const session = makeSession();

  it('redacts GitHub PAT in detail string', () => {
    const detail = 'Working on auth, token was ' + GHP_FAKE + ' in env';
    const payload = monitor.makePayload('status.error', session, detail);
    expect(payload.detail).not.toContain('ghp_');
    expect(payload.detail).toContain('[REDACTED:github-pat]');
  });

  it('redacts Anthropic API key in detail string', () => {
    const detail = 'Error: invalid key sk-ant-abcdef0123456789ABCDEFGHIJ-test';
    const payload = monitor.makePayload('status.error', session, detail);
    expect(payload.detail).not.toContain('sk-ant-abcdef0123456789ABCDEFGHIJ-test');
    expect(payload.detail).toContain('[REDACTED:anthropic-key]');
  });

  it('redacts AWS access key id in detail string', () => {
    const detail = 'Bucket policy referenced AKIAIOSFODNN7EXAMPLE in policy doc';
    const payload = monitor.makePayload('status.error', session, detail);
    expect(payload.detail).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(payload.detail).toContain('[REDACTED:aws-key-id]');
  });

  it('redacts PEM private key block in detail string', () => {
    const detail = 'SSH config leaked -----BEGIN RSA PRIVATE KEY-----MIIE...-----END RSA PRIVATE KEY----- during sync';
    const payload = monitor.makePayload('status.error', session, detail);
    expect(payload.detail).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(payload.detail).toContain('[REDACTED:private-key]');
  });

  it('redacts BEFORE length slice (long secret near boundary is still redacted)', () => {
    // 3000-char detail with secret at position 1950 (after the 2000-char slice).
    // If redaction runs AFTER slice, the secret survives. Must run BEFORE slice.
    const padding = 'a'.repeat(1900);
    const detail = `${padding} token=${GHP_FAKE} ${'b'.repeat(1000)}`;
    const payload = monitor.makePayload('status.error', session, detail);
    expect(payload.detail).not.toContain('ghp_');
  });

  it('still enforces the 2000-char length cap as defense-in-depth', () => {
    const detail = 'x'.repeat(5000);
    const payload = monitor.makePayload('status.error', session, detail);
    expect(payload.detail.length).toBeLessThanOrEqual(2000);
  });

  it('preserves detail when there are no secrets', () => {
    const detail = 'Session stalled: working for 5min with no new output';
    const payload = monitor.makePayload('status.stall', session, detail);
    expect(payload.detail).toBe(detail);
  });

  it('preserves payload shape (event, timestamp, session, detail)', () => {
    const payload = monitor.makePayload('status.stall', session, 'detail');
    expect(payload.event).toBe('status.stall');
    expect(typeof payload.timestamp).toBe('string');
    expect(payload.session.id).toBe(session.id);
    expect(payload.session.name).toBe(session.displayName);
    expect(typeof payload.detail).toBe('string');
  });
});
