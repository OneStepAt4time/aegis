/**
 * store/useAuthStore.ts — Zustand store for authentication state.
 */

import { create } from 'zustand';
import { verifyToken } from '../api/client.js';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  isVerifying: boolean;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
  init: () => Promise<void>;
}

const TOKEN_KEY = 'aegis_token';

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  isAuthenticated: false,
  isVerifying: false,

  login: async (token: string): Promise<boolean> => {
    try {
      const result = await verifyToken(token);
      if (result.valid) {
        localStorage.setItem(TOKEN_KEY, token);
        set({ token, isAuthenticated: true });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, isAuthenticated: false });
    window.location.href = '/dashboard/login';
  },

  init: async () => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      set({ token: null, isAuthenticated: false });
      return;
    }
    set({ isVerifying: true });
    try {
      const result = await verifyToken(stored);
      if (result.valid) {
        set({ token: stored, isAuthenticated: true, isVerifying: false });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        set({ token: null, isAuthenticated: false, isVerifying: false });
      }
    } catch {
      set({ isVerifying: false });
    }
  },
}));
