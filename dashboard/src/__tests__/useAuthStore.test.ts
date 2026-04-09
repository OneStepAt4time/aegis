/**
 * useAuthStore.test.ts — Tests for the auth store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockVerifyToken = vi.fn();
const mockSetUnauthorizedHandler = vi.fn();

vi.mock('../api/client', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
  setUnauthorizedHandler: (...args: unknown[]) => mockSetUnauthorizedHandler(...args),
}));

// Lazy import so mock is in place
import { useAuthStore } from '../store/useAuthStore';

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
  });

  afterEach(() => {
    localStorage.removeItem('aegis_token');
    vi.restoreAllMocks();
  });

  describe('login', () => {
    it('stores token and sets authenticated on success', async () => {
      mockVerifyToken.mockResolvedValue({ valid: true, role: 'admin' });

      const success = await useAuthStore.getState().login('my-token');

      expect(success).toBe(true);
      expect(useAuthStore.getState().token).toBe('my-token');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(localStorage.getItem('aegis_token')).toBe('my-token');
    });

    it('does not store token on failure', async () => {
      mockVerifyToken.mockResolvedValue({ valid: false });

      const success = await useAuthStore.getState().login('bad-token');

      expect(success).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('aegis_token')).toBeNull();
    });

    it('handles network error gracefully', async () => {
      mockVerifyToken.mockRejectedValue(new Error('Network error'));

      const success = await useAuthStore.getState().login('some-token');

      expect(success).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
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
      expect(localStorage.getItem('aegis_token')).toBeNull();
    });
  });

  describe('init', () => {
    it('validates stored token and sets authenticated', async () => {
      localStorage.setItem('aegis_token', 'stored-token');
      mockVerifyToken.mockResolvedValue({ valid: true });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().token).toBe('stored-token');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().isVerifying).toBe(false);
    });

    it('clears invalid stored token', async () => {
      localStorage.setItem('aegis_token', 'expired-token');
      mockVerifyToken.mockResolvedValue({ valid: false });

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(localStorage.getItem('aegis_token')).toBeNull();
    });

    it('handles missing stored token without API call', async () => {
      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('handles API error during init', async () => {
      localStorage.setItem('aegis_token', 'some-token');
      mockVerifyToken.mockRejectedValue(new Error('Server error'));

      await useAuthStore.getState().init();

      expect(useAuthStore.getState().isVerifying).toBe(false);
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().token).toBe('some-token');
    });
  });
});
