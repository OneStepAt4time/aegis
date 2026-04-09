/**
 * store/useSidebarStore.ts — Zustand store for sidebar collapse state.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'aegis-sidebar-collapsed';

interface SidebarState {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  toggle: () => void;
  toggleMobile: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

function readInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isCollapsed: readInitialCollapsed(),
  isMobileOpen: false,

  toggle: () =>
    set((state) => {
      const next = !state.isCollapsed;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Ignore storage failures.
      }
      return { isCollapsed: next };
    }),

  toggleMobile: () =>
    set((state) => ({ isMobileOpen: !state.isMobileOpen })),

  setCollapsed: (collapsed: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // Ignore storage failures.
    }
    set({ isCollapsed: collapsed });
  },
}));
