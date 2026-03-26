/**
 * store/useToastStore.ts — Lightweight toast notification store.
 */

import { create } from 'zustand';

export type ToastType = 'error' | 'success' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (type: ToastType, title: string, description?: string) => string;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, title, description) => {
    const id = `toast-${++nextId}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, title, description }] }));
    // Auto-dismiss after 4s
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
    return id;
  },

  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
