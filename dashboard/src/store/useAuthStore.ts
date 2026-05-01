/**
 * store/useAuthStore.ts — Zustand store for authentication state.
 *
 * #1924: Token is held in memory only. Clearing on tab close / reload is
 * intentional; users re-authenticate via the login form. See ADR-0024.
 */

import { create } from 'zustand';
import {
  getDashboardSession,
  getOidcLoginUrl,
  logoutDashboardSession,
  setTokenAccessor,
  setUnauthorizedHandler,
  verifyToken,
  type DashboardSessionIdentity,
} from '../api/client.js';
import { useStore } from './useStore.js';

type AuthMode = 'token' | 'oidc' | null;

interface AuthState {
  token: string | null;
  authMode: AuthMode;
  identity: DashboardSessionIdentity | null;
  oidcAvailable: boolean | null;
  isAuthenticated: boolean;
  isVerifying: boolean;
  lastVerifiedAt: number | null;
  login: (token: string) => Promise<boolean>;
  loginWithOidc: () => void;
  logout: () => Promise<void>;
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

function clearAuthState(
  set: (partial: Partial<AuthState>) => void,
  options: { oidcAvailable?: boolean | null } = {},
): void {
  purgeLegacyToken();
  syncAuthToken(null);
  const partial: Partial<AuthState> = {
    token: null,
    authMode: null,
    identity: null,
    isAuthenticated: false,
    isVerifying: false,
    lastVerifiedAt: null,
  };
  if ('oidcAvailable' in options) {
    partial.oidcAvailable = options.oidcAvailable;
  }
  set(partial);
}

function setOidcAuthState(
  set: (partial: Partial<AuthState>) => void,
  identity: DashboardSessionIdentity,
): void {
  purgeLegacyToken();
  syncAuthToken(null);
  set({
    token: null,
    authMode: 'oidc',
    identity,
    oidcAvailable: true,
    isAuthenticated: true,
    isVerifying: false,
    lastVerifiedAt: null,
  });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  authMode: null,
  identity: null,
  oidcAvailable: null,
  isAuthenticated: false,
  isVerifying: true,
  lastVerifiedAt: null,

  login: async (token: string): Promise<boolean> => {
    purgeLegacyToken();

    try {
      const result = await verifyToken(token);
      if (result.valid) {
        syncAuthToken(token);
        set({
          token,
          authMode: 'token',
          identity: null,
          isAuthenticated: true,
          isVerifying: false,
          lastVerifiedAt: Date.now(),
        });
        return true;
      }
      clearAuthState(set, { oidcAvailable: get().oidcAvailable });
      return false;
    } catch {
      clearAuthState(set, { oidcAvailable: get().oidcAvailable });
      return false;
    }
  },

  loginWithOidc: () => {
    window.location.assign(getOidcLoginUrl());
  },

  logout: async () => {
    const state = get();
    const wasOidcSession = state.authMode === 'oidc';
    clearAuthState(set, { oidcAvailable: state.oidcAvailable });
    if (!wasOidcSession) return;

    try {
      const result = await logoutDashboardSession();
      if (result === 'unavailable') {
        set({ oidcAvailable: false });
      }
    } catch {
      // Local auth state is already cleared. The next /auth/session probe will
      // reconcile any stale server-side cookie without storing a client secret.
    }
  },

  init: async () => {
    purgeLegacyToken();

    setUnauthorizedHandler(() => {
      if (get().authMode === 'oidc') {
        return;
      }
      clearAuthState(set, { oidcAvailable: get().oidcAvailable });
    });
    setTokenAccessor(() => get().token);

    set({ isVerifying: true });

    // Skip /auth/session probe if OIDC was already determined unavailable
    // to avoid repeated 404 noise in token-auth-only deployments (issue #2348).
    if (get().oidcAvailable === false) {
      // OIDC not available — proceed directly to token auth restoration.
    } else {
      try {
        const session = await getDashboardSession();
        if (session.authenticated) {
          setOidcAuthState(set, session.identity);
          return;
        }
        set({ oidcAvailable: session.oidcAvailable });
      } catch {
        set({ oidcAvailable: false });
      }
    }

    const state = get();
    if (!state.token) {
      // No persisted token to restore. When OIDC is configured, the login page
      // will show the provider sign-in action; otherwise it falls back to API token login.
      clearAuthState(set, { oidcAvailable: state.oidcAvailable });
      return;
    }

    syncAuthToken(state.token);

    if (state.isAuthenticated && state.authMode === 'token') {
      set({ isVerifying: false });
      return;
    }

    await get().revalidate();
  },

  revalidate: async (force = false): Promise<boolean> => {
    const state = get();
    const token = state.token;
    if (!token) {
      if (state.authMode === 'oidc' && state.isAuthenticated) {
        return true;
      }
      clearAuthState(set, { oidcAvailable: state.oidcAvailable });
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
          set({
            token,
            authMode: 'token',
            identity: null,
            isAuthenticated: true,
            isVerifying: false,
            lastVerifiedAt: Date.now(),
          });
          return true;
        }
        clearAuthState(set, { oidcAvailable: get().oidcAvailable });
        return false;
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          clearAuthState(set, { oidcAvailable: get().oidcAvailable });
          return false;
        }
        // Network/server errors: keep existing token and avoid hard logout.
        syncAuthToken(token);
        set({ token, authMode: 'token', identity: null, isAuthenticated: true, isVerifying: false });
        return true;
      } finally {
        inFlightValidation = null;
      }
    })();

    return inFlightValidation;
  },
}));
