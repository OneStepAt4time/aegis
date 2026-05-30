/**
 * store/useInboxStore.ts — Inbox state management.
 */

import { create } from 'zustand';
import type { InboxItem, InboxFilter } from '../types/inbox';

interface InboxState {
  items: InboxItem[];
  unreadCount: number;
  filter: InboxFilter;
  isLoading: boolean;
  error: string | null;

  setItems: (items: InboxItem[], unreadCount: number) => void;
  addItems: (items: InboxItem[]) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  archiveItem: (id: string) => void;
  archiveAllRead: () => void;
  setFilter: (filter: InboxFilter) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  items: [],
  unreadCount: 0,
  filter: 'all',
  isLoading: false,
  error: null,

  setItems: (items, unreadCount) =>
    set({ items, unreadCount }),

  addItems: (newItems) =>
    set((state) => {
      const existingIds = new Set(state.items.map((i) => i.id));
      const filtered = newItems.filter((i) => !existingIds.has(i.id));
      if (filtered.length === 0) return state;
      return {
        items: [...filtered, ...state.items],
        unreadCount: state.unreadCount + filtered.filter((i) => !i.readAt).length,
      };
    }),

  markRead: (id) =>
    set((state) => {
      const wasUnread = state.items.find((i) => i.id === id && !i.readAt);
      return {
        items: state.items.map((i) =>
          i.id === id ? { ...i, readAt: i.readAt ?? new Date().toISOString() } : i,
        ),
        unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    }),

  markAllRead: () =>
    set((state) => ({
      items: state.items.map((i) => ({
        ...i,
        readAt: i.readAt ?? new Date().toISOString(),
      })),
      unreadCount: 0,
    })),

  archiveItem: (id) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.id === id ? { ...i, archivedAt: new Date().toISOString() } : i,
      ),
    })),

  archiveAllRead: () =>
    set((state) => ({
      items: state.items.map((i) =>
        !i.archivedAt && i.readAt ? { ...i, archivedAt: new Date().toISOString() } : i,
      ),
    })),

  setFilter: (filter) => set({ filter }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
