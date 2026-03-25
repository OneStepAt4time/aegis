/**
 * store/useStore.ts — Global Zustand store for the Aegis Dashboard.
 */

import { create } from 'zustand';
import type { SessionInfo, GlobalMetrics, ParsedEntry } from '../types';

export interface AppState {
  // Auth
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;

  // Sessions list
  sessions: SessionInfo[];
  setSessions: (sessions: SessionInfo[]) => void;

  // Global metrics
  metrics: GlobalMetrics | null;
  setMetrics: (metrics: GlobalMetrics) => void;

  // Selected session
  selectedSessionId: string | null;
  selectSession: (id: string | null) => void;

  // Messages per session
  sessionMessages: Map<string, ParsedEntry[]>;
  setSessionMessages: (sessionId: string, messages: ParsedEntry[]) => void;
  addMessage: (sessionId: string, entry: ParsedEntry) => void;

  // SSE connection status
  sseConnected: boolean;
  setSseConnected: (connected: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  // Auth
  token: localStorage.getItem('aegis_token'),
  setToken: (token) => {
    localStorage.setItem('aegis_token', token);
    set({ token });
  },
  clearToken: () => {
    localStorage.removeItem('aegis_token');
    set({ token: null });
  },

  // Sessions
  sessions: [],
  setSessions: (sessions) => set({ sessions }),

  // Metrics
  metrics: null,
  setMetrics: (metrics) => set({ metrics }),

  // Selected session
  selectedSessionId: null,
  selectSession: (id) => set({ selectedSessionId: id }),

  // Messages
  sessionMessages: new Map(),
  setSessionMessages: (sessionId, messages) =>
    set((state) => {
      const updated = new Map(state.sessionMessages);
      updated.set(sessionId, messages);
      return { sessionMessages: updated };
    }),
  addMessage: (sessionId, entry) =>
    set((state) => {
      const updated = new Map(state.sessionMessages);
      const existing = updated.get(sessionId) ?? [];
      updated.set(sessionId, [...existing, entry]);
      return { sessionMessages: updated };
    }),

  // SSE
  sseConnected: false,
  setSseConnected: (connected) => set({ sseConnected: connected }),
}));
