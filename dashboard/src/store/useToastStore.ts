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

const timers = new Map<string, ReturnType<typeof setTimeout>>();

let nextId = 0;

const AUTO_DISMISS_MS = 6000;
const MAX_TOASTS = 4;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, title, description) => {
    const id = `toast-${++nextId}`;
    const timer = setTimeout(() => {
      timers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, AUTO_DISMISS_MS);
    timers.set(id, timer);
    set((s) => {
      const next = [...s.toasts, { id, type, title, description }];
      // Evict oldest toasts beyond MAX_TOASTS
      if (next.length > MAX_TOASTS) {
        const evicted = next.splice(0, next.length - MAX_TOASTS);
        for (const t of evicted) {
          const existing = timers.get(t.id);
          if (existing) {
            clearTimeout(existing);
            timers.delete(t.id);
          }
        }
      }
      return { toasts: next };
    });
    return id;
  },

  removeToast: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
