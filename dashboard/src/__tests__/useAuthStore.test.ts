/**
 * useAuthStore.test.ts — Tests for the auth store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockSetUnauthorizedHandler = vi.fn();
const mockSetTokenAccessor = vi.fn();

vi.mock('../api/client', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  setUnauthorizedHandler: (...args: unknown[]) => mockSetUnauthorizedHandler(...args),
  setTokenAccessor: (...args: unknown[]) => mockSetTokenAccessor(...args),
}));

// Lazy import so mock is in place
import { useAuthStore } from '../store/useAuthStore';
import { useStore } from '../store/useStore';

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem('aegis_token');
    useAuthStore.setState({
      token: null,
      isAuthenticated: false,
      isVerifying: false,
      lastVerifiedAt: null,
    });
    useStore.getState().clearToken();
  });

  afterEach(() => {
    localStorage.removeItem('aegis_token');
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
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useStore.getState().token).toBe('my-token');
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
    it('clears token and resets auth state', () => {
      localStorage.setItem('aegis_token', 'stored-token');
      useAuthStore.setState({
        token: 'stored-token',
        isAuthenticated: true,
      });

      useAuthStore.getState().logout();

      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useStore.getState().token).toBeNull();
      expect(localStorage.getItem('aegis_token')).toBeNull();
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
    });

    it('preserves an authenticated in-memory token across route changes', async () => {
      useAuthStore.setState({
        token: 'live-token',
        isAuthenticated: true,
        isVerifying: false,
        lastVerifiedAt: Date.now(),
      });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().token).toBe('live-token');
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
        isAuthenticated: false,
        isVerifying: false,
        lastVerifiedAt: null,
      });
      mockVerifyToken.mockResolvedValue({ valid: true, role: 'admin' });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().token).toBe('some-token');
      expect(useStore.getState().token).toBe('some-token');
    });

    it('keeps the in-memory token on non-401 verify errors during init', async () => {
      useAuthStore.setState({
        token: 'some-token',
        isAuthenticated: false,
        isVerifying: false,
        lastVerifiedAt: null,
      });
      mockVerifyToken.mockRejectedValue(new Error('Server error'));

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isVerifying).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().token).toBe('some-token');
      expect(useStore.getState().token).toBe('some-token');
    });
  });
});
