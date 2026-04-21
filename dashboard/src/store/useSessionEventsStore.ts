/**
 * store/useSessionEventsStore.ts — Single source of truth for per-session
 * transcript entries + SSE-driven counts.
 *
 * Issue 07 of the `session-cockpit` epic. See `.claude/epics/session-cockpit/epic.md`.
 *
 * Why this store exists: the Session Detail page historically reads message
 * counts from `GET /v1/sessions/:id/metrics` and transcript bubbles from
 * `GET /v1/sessions/:id/messages`. Those two endpoints drift — one updates
 * before the other — producing the user-facing contradiction where the
 * Metrics tab shows `MESSAGES: 0` next to `118,471 tokens`. This store
 * keeps the transcript as one array and derives the counts from it, so
 * there is no second source to disagree with.
 *
 * Token / cost metrics still come from `getSessionMetrics`; they live in
 * a parallel slice on the same store so consumers can bind once.
 */

import { create } from 'zustand';
import type { ParsedEntry, UIState, SessionMetrics } from '../types';

export interface SessionEventState {
  /** Transcript entries. Replaced wholesale on each refetch. */
  entries: ParsedEntry[];
  /** UI state reported alongside the last successful messages fetch. */
  status: UIState | null;
  /** Running SSE-event counters since the session was first observed. */
  approvalCount: number;
  autoApprovalCount: number;
  statusChangeCount: number;
  /** Metrics slice — tokens and cost only. Counts are derived. */
  metrics: SessionMetrics | null;
  /** True until the first messages fetch resolves. */
  loading: boolean;
  /** Last time entries or metrics were updated (ms epoch). */
  lastUpdatedAt: number;
  /** Error from the most recent messages fetch, if any. */
  error: string | null;
  /**
   * Seek signal for transcript scroll-sync. Set by timeline / scrubber
   * consumers; the TranscriptView effect scrolls to the nearest entry
   * when `seekNonce` changes — a nonce (rather than just the ms value)
   * allows consecutive seeks to the same timestamp to still trigger.
   */
  seekMs: number | null;
  seekNonce: number;
  /**
   * Model name parsed from the Claude CLI status footer (e.g.
   * "claude-opus-4-7", "glm-5.1"). Lifted out of ClaudeStatusStrip so
   * the Metrics banner can display it with the family accent color.
   */
  model: string | null;
}

type SessionMap = Record<string, SessionEventState>;

interface SessionEventsStore {
  sessions: SessionMap;

  /** Initialize an empty slot for a session (idempotent). */
  ensureSession: (sessionId: string) => void;
  /** Replace the entries array (after a successful messages fetch). */
  setEntries: (sessionId: string, entries: ParsedEntry[], status: UIState) => void;
  /** Set the metrics slice (tokens + cost). Derived counts do not come from here. */
  setMetrics: (sessionId: string, metrics: SessionMetrics) => void;
  /** Flip the loading flag. */
  setLoading: (sessionId: string, loading: boolean) => void;
  /** Record an error from the last messages/metrics fetch. */
  setError: (sessionId: string, error: string | null) => void;
  /** Increment a running SSE counter by name. */
  incrementCounter: (
    sessionId: string,
    counter: 'approvalCount' | 'autoApprovalCount' | 'statusChangeCount',
  ) => void;
  /** Drop a session slot (called on unmount — frees memory). */
  clearSession: (sessionId: string) => void;
  /**
   * Signal a seek to a specific timestamp. Each call bumps `seekNonce`
   * so repeated seeks to the same ms still fire the TranscriptView effect.
   */
  setSeek: (sessionId: string, ms: number) => void;
  /** Record the active model name parsed from the CLI status footer. */
  setModel: (sessionId: string, model: string) => void;
}

function emptyState(): SessionEventState {
  return {
    entries: [],
    status: null,
    approvalCount: 0,
    autoApprovalCount: 0,
    statusChangeCount: 0,
    metrics: null,
    loading: true,
    lastUpdatedAt: 0,
    error: null,
    seekMs: null,
    seekNonce: 0,
    model: null,
  };
}

export const useSessionEventsStore = create<SessionEventsStore>((set) => ({
  sessions: {},

  ensureSession: (sessionId) =>
    set((s) => {
      if (s.sessions[sessionId]) return s;
      return { sessions: { ...s.sessions, [sessionId]: emptyState() } };
    }),

  setEntries: (sessionId, entries, status) =>
    set((s) => {
      const prev = s.sessions[sessionId] ?? emptyState();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...prev,
            entries,
            status,
            loading: false,
            lastUpdatedAt: Date.now(),
            error: null,
          },
        },
      };
    }),

  setMetrics: (sessionId, metrics) =>
    set((s) => {
      const prev = s.sessions[sessionId] ?? emptyState();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...prev, metrics, lastUpdatedAt: Date.now() },
        },
      };
    }),

  setLoading: (sessionId, loading) =>
    set((s) => {
      const prev = s.sessions[sessionId] ?? emptyState();
      return { sessions: { ...s.sessions, [sessionId]: { ...prev, loading } } };
    }),

  setError: (sessionId, error) =>
    set((s) => {
      const prev = s.sessions[sessionId] ?? emptyState();
      return { sessions: { ...s.sessions, [sessionId]: { ...prev, error, loading: false } } };
    }),

  incrementCounter: (sessionId, counter) =>
    set((s) => {
      const prev = s.sessions[sessionId] ?? emptyState();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...prev, [counter]: prev[counter] + 1 },
        },
      };
    }),

  clearSession: (sessionId) =>
    set((s) => {
      if (!s.sessions[sessionId]) return s;
      const next = { ...s.sessions };
      delete next[sessionId];
      return { sessions: next };
    }),

  setSeek: (sessionId, ms) =>
    set((s) => {
      const prev = s.sessions[sessionId] ?? emptyState();
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...prev, seekMs: ms, seekNonce: prev.seekNonce + 1 },
        },
      };
    }),

  setModel: (sessionId, model) =>
    set((s) => {
      const prev = s.sessions[sessionId] ?? emptyState();
      if (prev.model === model) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...prev, model },
        },
      };
    }),
}));

// ── Derived selectors ────────────────────────────────────────────────

/** Count of user + assistant `text` entries. Matches what a human would
 *  call "messages" on a transcript. */
export function selectMessageCount(state: SessionEventState): number {
  return state.entries.filter(
    (e) => e.contentType === 'text' && (e.role === 'user' || e.role === 'assistant'),
  ).length;
}

export function selectUserMessageCount(state: SessionEventState): number {
  return state.entries.filter((e) => e.role === 'user' && e.contentType === 'text').length;
}

export function selectAssistantMessageCount(state: SessionEventState): number {
  return state.entries.filter((e) => e.role === 'assistant' && e.contentType === 'text').length;
}

/** Count of `tool_use` entries. Matches what a human would call
 *  "tool calls". `tool_result` / `tool_error` are not counted — they
 *  are the response side of an already-counted call. */
export function selectToolCallCount(state: SessionEventState): number {
  return state.entries.filter((e) => e.contentType === 'tool_use').length;
}

export function selectThinkingCount(state: SessionEventState): number {
  return state.entries.filter((e) => e.contentType === 'thinking').length;
}

/** Returns the `SessionEventState` for a session, or a fresh empty state
 *  if the session has not been registered. Callers can rely on the shape
 *  always being populated. */
export function selectSession(
  state: SessionEventsStore,
  sessionId: string,
): SessionEventState {
  return state.sessions[sessionId] ?? emptyState();
}
