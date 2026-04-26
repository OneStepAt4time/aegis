/**
 * store/useDrawerStore.ts — Global drawer and palette state.
 */

import { create } from 'zustand';

interface DrawerState {
  newSessionOpen: boolean;
  openNewSession: () => void;
  closeNewSession: () => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  newSessionOpen: false,
  openNewSession: () => set({ newSessionOpen: true }),
  closeNewSession: () => set({ newSessionOpen: false }),
  paletteOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
}));
