/**
 * store/useAuthStore.ts — Zustand store for authentication state.
 *
 * #1924: Token is held in memory only. Clearing on tab close / reload is
 * intentional; users re-authenticate via the login form. See ADR-0024.
 */

import { create } from 'zustand';
import { setTokenAccessor, setUnauthorizedHandler, verifyToken } from '../api/client.js';
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

// #1924: Legacy key — kept only to purge any token that older dashboard
// versions wrote to localStorage. Never written to after migration.
const LEGACY_TOKEN_KEY = 'aegis_token';
const REVALIDATE_TTL_MS = 60_000;

let inFlightValidation: Promise<boolean> | null = null;

function purgeLegacyToken(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // ignore storage access errors (e.g., disabled in browser)
  }
}

function syncAuthToken(token: string | null): void {
  if (token) {
    useStore.getState().setToken(token);
    return;
  }
  useStore.getState().clearToken();
}

function clearAuthState(set: (partial: Partial<AuthState>) => void): void {
  purgeLegacyToken();
  syncAuthToken(null);
  set({ token: null, isAuthenticated: false, isVerifying: false, lastVerifiedAt: null });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  isAuthenticated: false,
  isVerifying: false,
  lastVerifiedAt: null,

  login: async (token: string): Promise<boolean> => {
    purgeLegacyToken();

    try {
      const result = await verifyToken(token);
      if (result.valid) {
        syncAuthToken(token);
        set({ token, isAuthenticated: true, isVerifying: false, lastVerifiedAt: Date.now() });
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
    purgeLegacyToken();

    setUnauthorizedHandler(() => {
      clearAuthState(set);
    });
    setTokenAccessor(() => get().token);

    const state = get();
    if (!state.token) {
      // No persisted token to restore — user must re-authenticate on reload.
      clearAuthState(set);
      return;
    }

    syncAuthToken(state.token);

    if (state.isAuthenticated) {
      set({ isVerifying: false });
      return;
    }

    await get().revalidate();
  },

  revalidate: async (force = false): Promise<boolean> => {
    const state = get();
    const token = state.token;
    if (!token) {
      clearAuthState(set);
      return false;
    }

    syncAuthToken(token);

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
          syncAuthToken(token);
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
        syncAuthToken(token);
        set({ token, isAuthenticated: true, isVerifying: false });
        return true;
      } finally {
        inFlightValidation = null;
      }
    })();

    return inFlightValidation;
  },
}));
