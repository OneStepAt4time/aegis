/**
 * useDrawerStore.test.ts — Tests for drawer state store.
 */

import { describe, it, expect } from 'vitest';
import { useDrawerStore } from '../useDrawerStore';

describe('useDrawerStore', () => {
  it('starts with drawers closed', () => {
    const state = useDrawerStore.getState();
    expect(state.newSessionOpen).toBe(false);
    expect(state.paletteOpen).toBe(false);
  });

  it('opens and closes new session drawer', () => {
    useDrawerStore.getState().openNewSession();
    expect(useDrawerStore.getState().newSessionOpen).toBe(true);

    useDrawerStore.getState().closeNewSession();
    expect(useDrawerStore.getState().newSessionOpen).toBe(false);
  });

  it('opens and closes command palette', () => {
    useDrawerStore.getState().openPalette();
    expect(useDrawerStore.getState().paletteOpen).toBe(true);

    useDrawerStore.getState().closePalette();
    expect(useDrawerStore.getState().paletteOpen).toBe(false);
  });
});
