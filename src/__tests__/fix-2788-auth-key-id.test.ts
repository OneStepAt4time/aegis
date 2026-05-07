/**
 * Tests for Issue #2788: Auth key routes reject non-UUID key IDs.
 *
 * The global onRequest hook validates all :id params as UUIDs, but
 * auth key IDs are hex strings (e.g. "9c855a8b4680011c"), not UUIDs.
 * The fix skips UUID validation for /v1/auth/keys/* and /v1/keys/* routes.
 */

import { describe, it, expect } from 'vitest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_RE.test(id);
}

// Mirrors the logic in server.ts post-fix
const AUTH_KEY_ID_PREFIXES = ['/v1/auth/keys/', '/v1/keys/'];

function shouldValidateAsUUID(urlPath: string): boolean {
  const stripped = urlPath.split('?')[0] ?? '';
  const isAuthKeyRoute = AUTH_KEY_ID_PREFIXES.some(p => stripped.startsWith(p));
  return !isAuthKeyRoute;
}

describe('#2788: auth key ID validation', () => {
  it('should skip UUID check for /v1/auth/keys/:id routes', () => {
    expect(shouldValidateAsUUID('/v1/auth/keys/9c855a8b4680011c')).toBe(false);
    expect(shouldValidateAsUUID('/v1/auth/keys/9c855a8b4680011c/rotate')).toBe(false);
    expect(shouldValidateAsUUID('/v1/auth/keys/9c855a8b4680011c/quotas')).toBe(false);
  });

  it('should skip UUID check for /v1/keys/:id routes', () => {
    expect(shouldValidateAsUUID('/v1/keys/9c855a8b4680011c')).toBe(false);
  });

  it('should enforce UUID check for session routes', () => {
    expect(shouldValidateAsUUID('/v1/sessions/not-a-uuid')).toBe(true);
    expect(shouldValidateAsUUID('/v1/sessions/abc123/send')).toBe(true);
  });

  it('should enforce UUID check for other :id routes', () => {
    expect(shouldValidateAsUUID('/v1/sessions/abc-123/events')).toBe(true);
  });

  it('should validate hex key ID as non-UUID', () => {
    const keyId = '9c855a8b4680011c';
    expect(isValidUUID(keyId)).toBe(false);
  });

  it('should accept valid UUID for session routes', () => {
    const sessionId = '00000000-0000-0000-0000-000000000001';
    expect(isValidUUID(sessionId)).toBe(true);
  });

  it('should not skip UUID check for /v1/sessions routes', () => {
    // These should still be validated as UUIDs
    expect(shouldValidateAsUUID('/v1/sessions/00000000-0000-0000-0000-000000000001')).toBe(true);
    expect(shouldValidateAsUUID('/v1/sessions/00000000-0000-0000-0000-000000000001/send')).toBe(true);
    expect(shouldValidateAsUUID('/v1/sessions/00000000-0000-0000-0000-000000000001/events')).toBe(true);
  });
});
