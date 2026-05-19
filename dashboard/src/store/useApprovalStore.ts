/**
 * store/useApprovalStore.ts — Global pending approval state.
 *
 * Tracks sessions with pending permission prompts across the dashboard.
 * Populated from session list API polling + SSE events.
 * Used by: ApprovalNotification, sidebar badge, session table indicators.
 *
 * Related: #3622 Tier 1 (Permission Approval Flow UI)
 */

import { create } from "zustand";

export interface PendingApproval {
  sessionId: string;
  sessionName: string;
  toolName?: string;
  prompt?: string;
  startedAt: number;
  expiresAt?: number;
}

export interface ApprovalStoreState {
  /** Map of sessionId → pending approval. */
  pending: Map<string, PendingApproval>;

  /** Add or update a pending approval (from SSE or polling). */
  addApproval: (approval: PendingApproval) => void;

  /** Remove a pending approval (approved/rejected/expired). */
  removeApproval: (sessionId: string) => void;

  /** Bulk-set from session list API response. */
  setFromSessions: (sessions: Array<{
    id: string;
    displayName: string;
    status: string;
    pendingPermission?: { toolName?: string; prompt?: string; startedAt: number; expiresAt?: number } | null;
  }>) => void;

  /** Count of pending approvals. */
  count: () => number;

  /** Get all pending approvals as array. */
  list: () => PendingApproval[];
}

export const useApprovalStore = create<ApprovalStoreState>((set, get) => ({
  pending: new Map(),

  addApproval: (approval) =>
    set((state) => {
      const next = new Map(state.pending);
      next.set(approval.sessionId, approval);
      return { pending: next };
    }),

  removeApproval: (sessionId) =>
    set((state) => {
      const next = new Map(state.pending);
      next.delete(sessionId);
      return { pending: next };
    }),

  setFromSessions: (sessions) =>
    set(() => {
      const next = new Map<string, PendingApproval>();
      for (const s of sessions) {
        if (s.status === "permission_prompt" && s.pendingPermission) {
          next.set(s.id, {
            sessionId: s.id,
            sessionName: s.displayName,
            toolName: s.pendingPermission.toolName,
            prompt: s.pendingPermission.prompt,
            startedAt: s.pendingPermission.startedAt,
            expiresAt: s.pendingPermission.expiresAt,
          });
        }
      }
      return { pending: next };
    }),

  count: () => get().pending.size,

  list: () => Array.from(get().pending.values()),
}));
