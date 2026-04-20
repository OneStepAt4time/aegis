/**
 * store/useDrawerStore.ts — Global drawer state for the New Session drawer.
 */

import { create } from 'zustand';

interface DrawerState {
  newSessionOpen: boolean;
  openNewSession: () => void;
  closeNewSession: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  newSessionOpen: false,
  openNewSession: () => set({ newSessionOpen: true }),
  closeNewSession: () => set({ newSessionOpen: false }),
}));
