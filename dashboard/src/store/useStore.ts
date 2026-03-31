/**
 * store/useStore.ts — Global Zustand store for the Aegis Dashboard.
 */

import { create } from 'zustand';
import type { SessionInfo, GlobalMetrics, GlobalSSEEvent, GlobalSSEEventType, RowHealth } from '../types';

export interface AppState {
  // Auth
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;

  // Sessions list
  sessions: SessionInfo[];
  setSessions: (sessions: SessionInfo[]) => void;

  // Session health map (keyed by session ID)
  healthMap: Record<string, RowHealth>;
  setSessionsAndHealth: (sessions: SessionInfo[], healthMap: Record<string, RowHealth>) => void;

  // Global metrics
  metrics: GlobalMetrics | null;
  setMetrics: (metrics: GlobalMetrics) => void;

  // SSE connection status
  sseConnected: boolean;
  setSseConnected: (connected: boolean) => void;
  sseError: string | null;
  setSseError: (error: string | null) => void;

  // Activity stream
  activities: GlobalSSEEvent[];
  addActivity: (event: GlobalSSEEvent) => void;
  clearActivities: () => void;
  activityFilterSession: string | null;
  setActivityFilterSession: (id: string | null) => void;
  activityFilterType: GlobalSSEEventType | null;
  setActivityFilterType: (type: GlobalSSEEventType | null) => void;
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

  // Session health map
  healthMap: {},
  setSessionsAndHealth: (sessions, healthMap) => set({ sessions, healthMap }),

  // Metrics
  metrics: null,
  setMetrics: (metrics) => set({ metrics }),

  // SSE
  sseConnected: false,
  setSseConnected: (connected) => set({ sseConnected: connected }),
  sseError: null,
  setSseError: (error) => set({ sseError: error }),

  // Activity stream
  activities: [],
  addActivity: (event) =>
    set((state) => ({
      activities: [event, ...state.activities].slice(0, 200),
    })),
  clearActivities: () => set({ activities: [] }),
  activityFilterSession: null,
  setActivityFilterSession: (id) => set({ activityFilterSession: id }),
  activityFilterType: null,
  setActivityFilterType: (type) => set({ activityFilterType: type }),
}));
