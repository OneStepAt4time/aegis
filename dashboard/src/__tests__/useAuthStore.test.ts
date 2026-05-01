/**
 * useAuthStore.test.ts — Tests for the auth store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DashboardSessionIdentity } from '../api/client';

const mockVerifyToken = vi.fn();
const mockSetUnauthorizedHandler = vi.fn();
const mockSetTokenAccessor = vi.fn();
const mockGetDashboardSession = vi.fn();
const mockLogoutDashboardSession = vi.fn();
const mockGetOidcLoginUrl = vi.fn();

vi.mock('../api/client', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  setUnauthorizedHandler: (...args: unknown[]) => mockSetUnauthorizedHandler(...args),
  setTokenAccessor: (...args: unknown[]) => mockSetTokenAccessor(...args),
  getDashboardSession: (...args: unknown[]) => mockGetDashboardSession(...args),
  logoutDashboardSession: (...args: unknown[]) => mockLogoutDashboardSession(...args),
  getOidcLoginUrl: (...args: unknown[]) => mockGetOidcLoginUrl(...args),
}));

// Lazy import so mock is in place
import { useAuthStore } from '../store/useAuthStore';
import { useStore } from '../store/useStore';

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDashboardSession.mockResolvedValue({ oidcAvailable: false, authenticated: false });
    mockLogoutDashboardSession.mockResolvedValue('logged-out');
    mockGetOidcLoginUrl.mockReturnValue('/auth/login');
    localStorage.removeItem('aegis_token');
    sessionStorage.clear();
    useAuthStore.setState({
      token: null,
      authMode: null,
      identity: null,
      oidcAvailable: null,
      isAuthenticated: false,
      isVerifying: false,
      lastVerifiedAt: null,
    });
    useStore.getState().clearToken();
  });

  afterEach(() => {
    localStorage.removeItem('aegis_token');
    sessionStorage.clear();
    useStore.getState().clearToken();
    vi.restoreAllMocks();
  });

  describe('login', () => {
    it('stores token in memory and sets authenticated on success', async () => {
      mockVerifyToken.mockResolvedValue({ valid: true, role: 'admin' });
      localStorage.setItem('aegis_token', 'legacy-token');

      const success = await useAuthStore.getState().login('my-token');

      expect(success).toBe(true);
      expect(useAuthStore.getState().token).toBe('my-token');
      expect(useAuthStore.getState().authMode).toBe('token');
      expect(useAuthStore.getState().identity).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useStore.getState().token).toBe('my-token');
      expect(localStorage.getItem('aegis_token')).toBeNull();
    });

    it('upgrades token login to an HttpOnly dashboard session without Web Storage persistence (#2351)', async () => {
      const identity: DashboardSessionIdentity = {
        authenticated: true,
        userId: 'api-key:key-1',
        tenantId: 'default',
        role: 'admin',
        createdAt: 1,
        expiresAt: 2,
      };
      mockVerifyToken.mockResolvedValue({ valid: true, role: 'admin' });
      mockGetDashboardSession.mockResolvedValueOnce({
        oidcAvailable: false,
        authenticated: true,
        authMethod: 'token',
        identity,
      });

      const success = await useAuthStore.getState().login('my-token');

      expect(success).toBe(true);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().authMode).toBe('token');
      expect(useAuthStore.getState().identity).toEqual(identity);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useStore.getState().token).toBeNull();
      expect(localStorage.getItem('aegis_token')).toBeNull();
    });

    it('does not store token on failure', async () => {
      mockVerifyToken.mockResolvedValue({ valid: false });

      const success = await useAuthStore.getState().login('bad-token');

      expect(success).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useStore.getState().token).toBeNull();
      expect(localStorage.getItem('aegis_token')).toBeNull();
    });

    it('handles network error gracefully', async () => {
      mockVerifyToken.mockRejectedValue(new Error('Network error'));

      const success = await useAuthStore.getState().login('some-token');

      expect(success).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useStore.getState().token).toBeNull();
    });
  });

  describe('logout', () => {
    it('clears token and resets auth state', async () => {
      localStorage.setItem('aegis_token', 'stored-token');
      useAuthStore.setState({
        token: 'stored-token',
        authMode: 'token',
        identity: null,
        isAuthenticated: true,
      });

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().authMode).toBeNull();
      expect(useAuthStore.getState().identity).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useStore.getState().token).toBeNull();
      expect(localStorage.getItem('aegis_token')).toBeNull();
      expect(mockLogoutDashboardSession).not.toHaveBeenCalled();
    });

    it('posts OIDC logout for OIDC sessions and clears local state', async () => {
      useAuthStore.setState({
        token: null,
        authMode: 'oidc',
        identity: {
          authenticated: true,
          userId: 'user-123',
          email: 'dev@example.com',
          tenantId: 'default',
          role: 'viewer',
          createdAt: 1,
          expiresAt: 2,
        },
        oidcAvailable: true,
        isAuthenticated: true,
      });

      await useAuthStore.getState().logout();

      expect(mockLogoutDashboardSession).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().authMode).toBeNull();
      expect(useAuthStore.getState().identity).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useStore.getState().token).toBeNull();
    });

    it('posts logout for cookie-backed token sessions and clears local state', async () => {
      useAuthStore.setState({
        token: null,
        authMode: 'token',
        identity: {
          authenticated: true,
          userId: 'api-key:key-1',
          tenantId: 'default',
          role: 'viewer',
          createdAt: 1,
          expiresAt: 2,
        },
        oidcAvailable: false,
        isAuthenticated: true,
      });

      await useAuthStore.getState().logout();

      expect(mockLogoutDashboardSession).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().authMode).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('init', () => {
    it('cleans up the legacy localStorage token and leaves reloads signed out', async () => {
      localStorage.setItem('aegis_token', 'stored-token');

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().isVerifying).toBe(false);
      expect(localStorage.getItem('aegis_token')).toBeNull();
      expect(mockVerifyToken).not.toHaveBeenCalled();
      expect(mockSetUnauthorizedHandler).toHaveBeenCalledTimes(1);
      expect(mockSetTokenAccessor).toHaveBeenCalledTimes(1);
      expect(mockGetDashboardSession).toHaveBeenCalledTimes(1);
    });

    it('restores an authenticated dashboard OIDC session without storing API tokens', async () => {
      const identity: DashboardSessionIdentity = {
        authenticated: true,
        userId: 'user-123',
        email: 'dev@example.com',
        tenantId: 'default',
        role: 'viewer',
        createdAt: 1,
        expiresAt: 2,
      };
      mockGetDashboardSession.mockResolvedValueOnce({
        oidcAvailable: true,
        authenticated: true,
        authMethod: 'oidc',
        identity,
      });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().authMode).toBe('oidc');
      expect(useAuthStore.getState().identity).toEqual(identity);
      expect(useAuthStore.getState().oidcAvailable).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useStore.getState().token).toBeNull();
      expect(localStorage.getItem('aegis_token')).toBeNull();
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('restores a cookie-backed token dashboard session on reload without sessionStorage/localStorage token (#2351)', async () => {
      const identity: DashboardSessionIdentity = {
        authenticated: true,
        userId: 'api-key:key-1',
        tenantId: 'default',
        role: 'operator',
        createdAt: 1,
        expiresAt: 2,
      };
      mockGetDashboardSession.mockResolvedValueOnce({
        oidcAvailable: false,
        authenticated: true,
        authMethod: 'token',
        identity,
      });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().authMode).toBe('token');
      expect(useAuthStore.getState().identity).toEqual(identity);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useStore.getState().token).toBeNull();
      expect(localStorage.getItem('aegis_token')).toBeNull();
      expect(sessionStorage.length).toBe(0);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('marks OIDC available when /auth/session returns unauthenticated', async () => {
      mockGetDashboardSession.mockResolvedValueOnce({ oidcAvailable: true, authenticated: false });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().oidcAvailable).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('preserves an authenticated in-memory token across route changes', async () => {
      useAuthStore.setState({
        token: 'live-token',
        authMode: 'token',
        identity: null,
        isAuthenticated: true,
        isVerifying: false,
        lastVerifiedAt: Date.now(),
      });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().token).toBe('live-token');
      expect(useAuthStore.getState().authMode).toBe('token');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useStore.getState().token).toBe('live-token');
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('handles missing in-memory token without API call', async () => {
      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('revalidates an in-memory token when auth state is incomplete', async () => {
      useAuthStore.setState({
        token: 'some-token',
        authMode: null,
        identity: null,
        isAuthenticated: false,
        isVerifying: false,
        lastVerifiedAt: null,
      });
      mockVerifyToken.mockResolvedValue({ valid: true, role: 'admin' });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().token).toBe('some-token');
      expect(useAuthStore.getState().authMode).toBe('token');
      expect(useStore.getState().token).toBe('some-token');
    });

    it('keeps the in-memory token on non-401 verify errors during init', async () => {
      useAuthStore.setState({
        token: 'some-token',
        authMode: null,
        identity: null,
        isAuthenticated: false,
        isVerifying: false,
        lastVerifiedAt: null,
      });
      mockVerifyToken.mockRejectedValue(new Error('Server error'));

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isVerifying).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().token).toBe('some-token');
      expect(useAuthStore.getState().authMode).toBe('token');
      expect(useStore.getState().token).toBe('some-token');
    });
  });
});
