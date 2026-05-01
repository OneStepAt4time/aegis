/**
 * Layout.mobile-nav-drawer.test.tsx — Tests for #2352 mobile nav drawer fixes.
 *
 * Verifies:
 * - Escape key closes the mobile nav drawer
 * - Mobile close button (X) is present when drawer is open
 * - Backdrop click closes the drawer
 * - Header actions become inert (pointer-events-none) when drawer is open
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockSubscribeGlobalSSE = vi.fn();
const mockGetHealth = vi.fn();
const mockCheckForUpdates = vi.fn();

vi.mock('../api/client', () => ({
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
  checkForUpdates: (...args: unknown[]) => mockCheckForUpdates(...args),
  subscribeGlobalSSE: (...args: unknown[]) => mockSubscribeGlobalSSE(...args),
}));

vi.mock('../components/ToastContainer', () => ({
  default: () => <div data-testid="toast-container" />,
}));

import Layout from '../components/Layout';
import { useSidebarStore } from '../store/useSidebarStore';

function renderLayout(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Test Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function setupDefaults() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockGetHealth.mockResolvedValue({
    status: 'ok',
    version: '2.13.1',
    uptime: 120,
    sessions: { active: 1, total: 1 },
    timestamp: new Date().toISOString(),
  });
  mockCheckForUpdates.mockResolvedValue({
    currentVersion: '2.13.1',
    latestVersion: '2.13.1',
    updateAvailable: false,
    releaseUrl: 'https://www.npmjs.com/package/@onestepat4time/aegis',
  });
  mockSubscribeGlobalSSE.mockReturnValue(() => {});
  localStorage.removeItem('aegis:update-check:v1');
  localStorage.removeItem('aegis-sidebar-collapsed');
  localStorage.removeItem('aegis-dashboard-theme');
}

describe('Layout mobile nav drawer (#2352)', () => {
  beforeEach(() => {
    setupDefaults();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem('aegis-sidebar-collapsed');
    localStorage.removeItem('aegis-dashboard-theme');
    useSidebarStore.setState({ isCollapsed: false, isMobileOpen: false });
  });

  describe('Escape key closes drawer', () => {
    it('closes the mobile drawer when Escape is pressed', async () => {
      useSidebarStore.setState({ isMobileOpen: true });
      renderLayout();
      expect(useSidebarStore.getState().isMobileOpen).toBe(true);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(useSidebarStore.getState().isMobileOpen).toBe(false);
    });

    it('does nothing when Escape is pressed and drawer is closed', () => {
      useSidebarStore.setState({ isMobileOpen: false });
      renderLayout();
      expect(useSidebarStore.getState().isMobileOpen).toBe(false);

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(useSidebarStore.getState().isMobileOpen).toBe(false);
    });
  });

  describe('closeMobile store action', () => {
    it('closeMobile sets isMobileOpen to false', () => {
      useSidebarStore.setState({ isMobileOpen: true });
      expect(useSidebarStore.getState().isMobileOpen).toBe(true);

      useSidebarStore.getState().closeMobile();
      expect(useSidebarStore.getState().isMobileOpen).toBe(false);
    });

    it('closeMobile is idempotent when already closed', () => {
      useSidebarStore.setState({ isMobileOpen: false });
      useSidebarStore.getState().closeMobile();
      expect(useSidebarStore.getState().isMobileOpen).toBe(false);
    });
  });

  describe('mobile close button (X)', () => {
    it('renders a close button inside the sidebar when mobile drawer is open', async () => {
      useSidebarStore.setState({ isMobileOpen: true });
      renderLayout();

      const closeBtn = await screen.findByRole('button', { name: 'Close menu' });
      expect(closeBtn).toBeDefined();
    });

    it('close button closes the drawer on click', async () => {
      useSidebarStore.setState({ isMobileOpen: true });
      renderLayout();

      const closeBtn = await screen.findByRole('button', { name: 'Close menu' });
      fireEvent.click(closeBtn);

      expect(useSidebarStore.getState().isMobileOpen).toBe(false);
    });
  });

  describe('backdrop closes drawer', () => {
    it('clicking the backdrop closes the mobile drawer', async () => {
      useSidebarStore.setState({ isMobileOpen: true });
      renderLayout();

      const backdrop = document.querySelector('[role="button"][tabindex="-1"]');
      expect(backdrop).not.toBeNull();

      fireEvent.click(backdrop!);
      expect(useSidebarStore.getState().isMobileOpen).toBe(false);
    });
  });

  describe('header actions inert when drawer open', () => {
    it('header actions container has pointer-events-none when mobile drawer is open', () => {
      // Open drawer BEFORE rendering so component renders with isMobileOpen=true
      useSidebarStore.setState({ isMobileOpen: true });
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      });
      renderLayout();

      const header = document.querySelector('header');
      const actionsContainer = header!.querySelector('.items-center.justify-end');
      expect(actionsContainer).not.toBeNull();
      expect(actionsContainer!.className).toContain('pointer-events-none');
    });

    it('header actions container does not have pointer-events-none when drawer is closed', () => {
      useSidebarStore.setState({ isMobileOpen: false });
      renderLayout();

      const header = document.querySelector('header');
      const actionsContainer = header!.querySelector('.items-center.justify-end');
      expect(actionsContainer).not.toBeNull();
      expect(actionsContainer!.className).not.toContain('pointer-events-none');
    });
  });
});
