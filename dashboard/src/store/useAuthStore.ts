/**
 * store/useAuthStore.ts — Zustand store for authentication state.
 */

import { create } from 'zustand';
import { setUnauthorizedHandler, verifyToken } from '../api/client.js';
import { useStore } from './useStore.js';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  isVerifying: boolean;
  lastVerifiedAt: number | null;
  login: (token: string) => Promise<boolean>;
  logout: () => void;
  init: () => Promise<void>;
  revalidate: (force?: boolean) => Promise<boolean>;
}

const TOKEN_KEY = 'aegis_token';
const REVALIDATE_TTL_MS = 60_000;

let inFlightValidation: Promise<boolean> | null = null;
let unauthorizedHandlerRegistered = false;

function clearAuthState(set: (partial: Partial<AuthState>) => void): void {
  localStorage.removeItem(TOKEN_KEY);
  useStore.getState().clearToken();
  set({ token: null, isAuthenticated: false, isVerifying: false, lastVerifiedAt: null });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem(TOKEN_KEY),
  isAuthenticated: false,
  isVerifying: true,
  lastVerifiedAt: null,

  login: async (token: string): Promise<boolean> => {
    try {
      const result = await verifyToken(token);
      if (result.valid) {
        localStorage.setItem(TOKEN_KEY, token);
        useStore.getState().setToken(token);
        set({ token, isAuthenticated: true, lastVerifiedAt: Date.now() });
        return true;
      }
      clearAuthState(set);
      return false;
    } catch {
      clearAuthState(set);
      return false;
    }
  },

  logout: () => {
    clearAuthState(set);
  },

  init: async () => {
    if (!unauthorizedHandlerRegistered) {
      setUnauthorizedHandler(() => {
        clearAuthState(set);
      });
      unauthorizedHandlerRegistered = true;
    }

    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      clearAuthState(set);
      return;
    }

    useStore.getState().setToken(stored);
    set({ token: stored });
    await get().revalidate();
  },

  revalidate: async (force = false): Promise<boolean> => {
    const state = get();
    const token = state.token ?? localStorage.getItem(TOKEN_KEY);
    if (!token) {
      clearAuthState(set);
      return false;
    }

    if (!force && state.lastVerifiedAt && (Date.now() - state.lastVerifiedAt) < REVALIDATE_TTL_MS) {
      return state.isAuthenticated;
    }

    if (inFlightValidation) {
      return inFlightValidation;
    }

    set({ isVerifying: true });
    inFlightValidation = (async () => {
      try {
        const result = await verifyToken(token);
        if (result.valid) {
          useStore.getState().setToken(token);
          set({ token, isAuthenticated: true, isVerifying: false, lastVerifiedAt: Date.now() });
          return true;
        }
        clearAuthState(set);
        return false;
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          clearAuthState(set);
          return false;
        }
        // Network/server errors: keep existing token and avoid hard logout.
        useStore.getState().setToken(token);
        set({ token, isAuthenticated: true, isVerifying: false });
        return true;
      } finally {
        inFlightValidation = null;
      }
    })();

    return inFlightValidation;
  },
}));
