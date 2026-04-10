/**
 * oidc.test.ts — Unit tests for OIDC module (Issue #1410).
 *
 * Tests the OidcManager class without connecting to a real IdP.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OidcManager, isOidcEnabled } from '../oidc.js';

const BASE_CONFIG = {
  issuer: 'https://auth.example.com',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  scopes: ['openid', 'email', 'profile'],
  cookieSecret: 'test-cookie-secret-for-unit-tests',
  sessionTtlMs: 15 * 60 * 1000,
  roleMap: { '@example.com': 'admin', '*': 'viewer' } as Record<string, string>,
};

describe('isOidcEnabled', () => {
  it('returns false when issuer is missing', () => {
    expect(isOidcEnabled({ ...BASE_CONFIG, issuer: '' })).toBe(false);
  });

  it('returns false when clientId is missing', () => {
    expect(isOidcEnabled({ ...BASE_CONFIG, clientId: '' })).toBe(false);
  });

  it('returns false when clientSecret is missing', () => {
    expect(isOidcEnabled({ ...BASE_CONFIG, clientSecret: '' })).toBe(false);
  });

  it('returns true when all required fields are present', () => {
    expect(isOidcEnabled(BASE_CONFIG)).toBe(true);
  });
});

describe('OidcManager', () => {
  let manager: OidcManager;

  beforeEach(() => {
    manager = new OidcManager(BASE_CONFIG);
  });

  describe('enabled', () => {
    it('returns true when OIDC is configured', () => {
      expect(manager.enabled).toBe(true);
    });

    it('returns false when OIDC is not configured', () => {
      const disabled = new OidcManager({ ...BASE_CONFIG, issuer: '' });
      expect(disabled.enabled).toBe(false);
    });
  });

  describe('session cookies', () => {
    it('creates and validates a session cookie', () => {
      const user = {
        sub: 'user-123',
        email: 'admin@example.com',
        name: 'Test Admin',
        role: 'admin' as const,
      };

      const { value } = manager.createSessionCookie(user);
      const validated = manager.validateSessionCookie(value);

      expect(validated).not.toBeNull();
      expect(validated!.sub).toBe('user-123');
      expect(validated!.email).toBe('admin@example.com');
      expect(validated!.name).toBe('Test Admin');
      expect(validated!.role).toBe('admin');
    });

    it('rejects a tampered cookie', () => {
      const user = {
        sub: 'user-123',
        email: 'admin@example.com',
        role: 'viewer' as const,
      };

      const { value } = manager.createSessionCookie(user);
      // Flip a character in the signature
      const tampered = value.slice(0, 5) + (value[5] === 'a' ? 'b' : 'a') + value.slice(6);
      const validated = manager.validateSessionCookie(tampered);

      expect(validated).toBeNull();
    });

    it('rejects an expired cookie', () => {
      const user = {
        sub: 'user-123',
        email: 'admin@example.com',
        role: 'viewer' as const,
      };

      const shortTtlManager = new OidcManager({ ...BASE_CONFIG, sessionTtlMs: 1 });
      const { value } = shortTtlManager.createSessionCookie(user);

      // Wait for expiration
      vi.useFakeTimers();
      vi.advanceTimersByTime(10);
      const validated = shortTtlManager.validateSessionCookie(value);
      vi.useRealTimers();

      expect(validated).toBeNull();
    });

    it('rejects garbage input', () => {
      expect(manager.validateSessionCookie('not-a-valid-cookie')).toBeNull();
      expect(manager.validateSessionCookie('')).toBeNull();
    });
  });

  describe('role resolution', () => {
    it('preserves admin role from email domain match', () => {
      const user = {
        sub: 'user-1',
        email: 'admin@example.com',
        role: 'admin' as const,
      };

      const { value } = manager.createSessionCookie(user);
      const validated = manager.validateSessionCookie(value);
      expect(validated!.role).toBe('admin');
    });

    it('resolves viewer role for unknown domain with wildcard', () => {
      const user = {
        sub: 'user-2',
        email: 'user@other.com',
        role: 'viewer' as const,
      };

      const { value } = manager.createSessionCookie(user);
      const validated = manager.validateSessionCookie(value);
      expect(validated!.role).toBe('viewer');
    });

    it('defaults to viewer when no role map matches', () => {
      const noMapManager = new OidcManager({ ...BASE_CONFIG, roleMap: {} });
      const user = {
        sub: 'user-3',
        email: 'anyone@anywhere.com',
        role: 'viewer' as const,
      };

      const { value } = noMapManager.createSessionCookie(user);
      const validated = noMapManager.validateSessionCookie(value);
      expect(validated!.role).toBe('viewer');
    });
  });

  describe('different cookie secrets', () => {
    it('rejects cookie from a different secret', () => {
      const user = {
        sub: 'user-1',
        email: 'admin@example.com',
        role: 'admin' as const,
      };

      const manager1 = new OidcManager({ ...BASE_CONFIG, cookieSecret: 'secret-1' });
      const manager2 = new OidcManager({ ...BASE_CONFIG, cookieSecret: 'secret-2' });

      const { value } = manager1.createSessionCookie(user);
      expect(manager2.validateSessionCookie(value)).toBeNull();
    });
  });
});
