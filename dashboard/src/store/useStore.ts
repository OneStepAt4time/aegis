/**
 * store/useStore.ts — Global Zustand store for the Aegis Dashboard.
 */

import { create } from 'zustand';
import type { SessionInfo, GlobalMetrics, GlobalSSEEvent, GlobalSSEEventType, RowHealth } from '../types';

export interface ActivityListItem extends GlobalSSEEvent {
  renderKey: string;
}

let nextActivityRenderId = 0;

function areHealthMapsEqual(a: Record<string, RowHealth>, b: Record<string, RowHealth>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    const left = a[key];
    const right = b[key];
    if (!right || left.alive !== right.alive || left.loading !== right.loading) {
      return false;
    }
  }

  return true;
}

function areSessionsEqual(a: SessionInfo[], b: SessionInfo[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.id !== right.id
      || left.windowId !== right.windowId
      || left.windowName !== right.windowName
      || left.workDir !== right.workDir
      || left.claudeSessionId !== right.claudeSessionId
      || left.jsonlPath !== right.jsonlPath
      || left.byteOffset !== right.byteOffset
      || left.monitorOffset !== right.monitorOffset
      || left.status !== right.status
      || left.createdAt !== right.createdAt
      || left.lastActivity !== right.lastActivity
      || left.stallThresholdMs !== right.stallThresholdMs
      || left.permissionMode !== right.permissionMode
      || left.autoApprove !== right.autoApprove
      || left.settingsPatched !== right.settingsPatched
      || left.promptDelivery?.delivered !== right.promptDelivery?.delivered
      || left.promptDelivery?.attempts !== right.promptDelivery?.attempts
    ) {
      return false;
    }
  }

  return true;
}

function areMetricsEqual(a: GlobalMetrics | null, b: GlobalMetrics | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return JSON.stringify(a) === JSON.stringify(b);
}

function makeActivityRenderKey(event: GlobalSSEEvent): string {
  nextActivityRenderId += 1;
  return `${nextActivityRenderId}:${event.sessionId}:${event.timestamp}:${event.event}`;
}

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
  setHealth: (healthMap: Record<string, RowHealth>) => void;

  // Global metrics
  metrics: GlobalMetrics | null;
  setMetrics: (metrics: GlobalMetrics) => void;

  // SSE connection status
  sseConnected: boolean;
  setSseConnected: (connected: boolean) => void;
  sseError: string | null;
  setSseError: (error: string | null) => void;

  // Activity stream
  activities: ActivityListItem[];
  addActivity: (event: GlobalSSEEvent) => void;
  clearActivities: () => void;
  activityFilterSession: string | null;
  setActivityFilterSession: (id: string | null) => void;
  activityFilterType: GlobalSSEEventType | null;
  setActivityFilterType: (type: GlobalSSEEventType | null) => void;
}

export const useStore = create<AppState>((set) => ({
  // Auth (#1924 → #2351: sessionStorage persistence for tab-lifetime token survival)
  // Token survives reloads and deep links within the same tab, cleared on tab close.
  // This is more secure than localStorage while meeting the UX expectation.
  token: (() => { try { return sessionStorage.getItem('aegis:auth:token'); } catch { return null; } })(),
  setToken: (token) => {
    try { sessionStorage.setItem('aegis:auth:token', token); } catch { /* storage disabled */ }
    set({ token });
  },
  clearToken: () => {
    try { sessionStorage.removeItem('aegis:auth:token'); } catch { /* storage disabled */ }
    set({ token: null });
  },

  // Sessions
  sessions: [],
  setSessions: (sessions) => set((state) => (areSessionsEqual(state.sessions, sessions) ? state : { sessions })),

  // Session health map
  healthMap: {},
  setSessionsAndHealth: (sessions, healthMap) => set((state) => (
    areSessionsEqual(state.sessions, sessions) && areHealthMapsEqual(state.healthMap, healthMap)
      ? state
      : { sessions, healthMap }
  )),
  setHealth: (healthMap) => set((state) => (
    areHealthMapsEqual(state.healthMap, healthMap) ? state : { healthMap }
  )),

  // Metrics
  metrics: null,
  setMetrics: (metrics) => set((state) => (areMetricsEqual(state.metrics, metrics) ? state : { metrics })),

  // SSE
  sseConnected: false,
  setSseConnected: (connected) => set({ sseConnected: connected }),
  sseError: null,
  setSseError: (error) => set({ sseError: error }),

  // Activity stream
  activities: [],
  addActivity: (event) =>
    set((state) => ({
      activities: [{ ...event, renderKey: makeActivityRenderKey(event) }, ...state.activities].slice(0, 200),
    })),
  clearActivities: () => set({ activities: [] }),
  activityFilterSession: null,
  setActivityFilterSession: (id) => set({ activityFilterSession: id }),
  activityFilterType: null,
  setActivityFilterType: (type) => set({ activityFilterType: type }),
}));
