/**
 * useSidebarStore.test.ts — Tests for sidebar collapse store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'aegis-sidebar-collapsed';

describe('useSidebarStore', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  describe('toggle', () => {
    it('toggles isCollapsed from false to true', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');
      useSidebarStore.setState({ isCollapsed: false });

      useSidebarStore.getState().toggle();

      expect(useSidebarStore.getState().isCollapsed).toBe(true);
    });

    it('toggles isCollapsed from true to false', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');
      useSidebarStore.setState({ isCollapsed: true });

      useSidebarStore.getState().toggle();

      expect(useSidebarStore.getState().isCollapsed).toBe(false);
    });

    it('persists collapsed state to localStorage', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');
      useSidebarStore.setState({ isCollapsed: false });

      useSidebarStore.getState().toggle();

      expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('persists expanded state to localStorage', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');
      useSidebarStore.setState({ isCollapsed: true });

      useSidebarStore.getState().toggle();

      expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    });
  });

  describe('setCollapsed', () => {
    it('sets isCollapsed to true', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');

      useSidebarStore.getState().setCollapsed(true);

      expect(useSidebarStore.getState().isCollapsed).toBe(true);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('sets isCollapsed to false', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');
      useSidebarStore.setState({ isCollapsed: true });

      useSidebarStore.getState().setCollapsed(false);

      expect(useSidebarStore.getState().isCollapsed).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    });
  });

  describe('toggleMobile', () => {
    it('toggles isMobileOpen from false to true', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');
      useSidebarStore.setState({ isMobileOpen: false });

      useSidebarStore.getState().toggleMobile();

      expect(useSidebarStore.getState().isMobileOpen).toBe(true);
    });

    it('toggles isMobileOpen from true to false', async () => {
      const { useSidebarStore } = await import('../store/useSidebarStore');
      useSidebarStore.setState({ isMobileOpen: true });

      useSidebarStore.getState().toggleMobile();

      expect(useSidebarStore.getState().isMobileOpen).toBe(false);
    });
  });

  describe('localStorage persistence', () => {
    it('reads collapsed=true from localStorage on init', async () => {
      localStorage.setItem(STORAGE_KEY, 'true');
      vi.resetModules();

      const { useSidebarStore } = await import('../store/useSidebarStore');

      expect(useSidebarStore.getState().isCollapsed).toBe(true);
    });

    it('defaults to expanded when localStorage has no value', async () => {
      vi.resetModules();

      const { useSidebarStore } = await import('../store/useSidebarStore');

      expect(useSidebarStore.getState().isCollapsed).toBe(false);
    });

    it('treats invalid localStorage value as expanded', async () => {
      localStorage.setItem(STORAGE_KEY, 'not-a-boolean');
      vi.resetModules();

      const { useSidebarStore } = await import('../store/useSidebarStore');

      expect(useSidebarStore.getState().isCollapsed).toBe(false);
    });
  });
});
