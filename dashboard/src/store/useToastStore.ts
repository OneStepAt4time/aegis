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

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (type, title, description) => {
    const id = `toast-${++nextId}`;
    const timer = setTimeout(() => {
      timers.delete(id);
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
    timers.set(id, timer);
    set((s) => ({ toasts: [...s.toasts, { id, type, title, description }] }));
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
