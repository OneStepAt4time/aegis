/**
 * cookie-secure-http.test.ts — Tests for Issue #2552.
 *
 * buildCookie should not set Secure flag when on HTTP connections.
 */

import { describe, it, expect } from 'vitest';
import { buildCookie, buildClearedCookie } from '../routes/oidc-auth.js';

describe('Cookie Secure flag (Issue #2552)', () => {
  it('buildCookie includes Secure when secure=true', () => {
    const cookie = buildCookie('test', 'value', 3600, 'Strict', true);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('buildCookie omits Secure when secure=false', () => {
    const cookie = buildCookie('test', 'value', 3600, 'Strict', false);
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('buildCookie defaults secure to true', () => {
    const cookie = buildCookie('test', 'value', 3600);
    expect(cookie).toContain('Secure');
  });

  it('buildClearedCookie includes Secure when secure=true', () => {
    const cookie = buildClearedCookie('test', 'Strict', true);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=0');
  });

  it('buildClearedCookie omits Secure when secure=false', () => {
    const cookie = buildClearedCookie('test', 'Strict', false);
    expect(cookie).not.toContain('Secure');
    expect(cookie).toContain('Max-Age=0');
  });

  it('buildClearedCookie defaults secure to true', () => {
    const cookie = buildClearedCookie('test');
    expect(cookie).toContain('Secure');
  });

  it('buildCookie with Lax sameSite', () => {
    const cookie = buildCookie('test', 'value', 3600, 'Lax', false);
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });
});
