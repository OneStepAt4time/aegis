/**
 * Layout.mobile-responsive.test.tsx — Tests for 375px viewport responsive fixes.
 *
 * Verifies that the footer, header, and main content use mobile-friendly classes:
 * - Footer hides ⌘K button, shows compact version, hides full version on mobile
 * - Header hides PREVIEW badge, "Check updates" button on mobile
 * - Main content uses reduced padding on small screens
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const SIDEBAR_STORAGE_KEY = 'aegis-sidebar-collapsed';

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
  localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  localStorage.removeItem('aegis-dashboard-theme');
  useSidebarStore.setState({ isCollapsed: false, isMobileOpen: false });
}

describe('Layout mobile responsive', () => {
  beforeEach(() => {
    setupDefaults();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    localStorage.removeItem('aegis-dashboard-theme');
  });

  describe('footer', () => {
    it('hides command palette button on mobile (hidden md:flex)', () => {
      renderLayout();

      const footer = document.querySelector('footer');
      expect(footer).not.toBeNull();

      // The ⌘K Command palette button should have hidden md:flex classes
      const cmdButtons = footer!.querySelectorAll('button');
      const paletteButton = Array.from(cmdButtons).find(
        (btn) => btn.textContent?.includes('Command palette'),
      );
      expect(paletteButton).toBeDefined();
      expect(paletteButton!.classList.contains('hidden')).toBe(true);
      expect(paletteButton!.classList.contains('md:flex')).toBe(true);
    });

    it('hides full version string on mobile, shows compact version', async () => {
      renderLayout();

      const version = await screen.findByText('v2.13.1');
      expect(version).toBeDefined();
      // Compact version should have sm:hidden (hidden on sm+)
      expect(version.classList.contains('sm:hidden')).toBe(true);
    });

    it('full version label is hidden on mobile (hidden sm:block)', async () => {
      renderLayout();

      const fullVersion = await screen.findByText('aegis v2.13.1');
      expect(fullVersion).toBeDefined();
      expect(fullVersion.classList.contains('hidden')).toBe(true);
      expect(fullVersion.classList.contains('sm:block')).toBe(true);
    });

    it('uses reduced horizontal padding on mobile (px-3)', () => {
      renderLayout();

      const footer = document.querySelector('footer');
      expect(footer).not.toBeNull();
      expect(footer!.classList.contains('px-3')).toBe(true);
      expect(footer!.classList.contains('sm:px-6')).toBe(true);
    });

    it('SSE indicator container has min-w-0 and truncate for overflow safety', () => {
      renderLayout();

      const footer = document.querySelector('footer');
      const sseDiv = footer!.querySelector('div');
      expect(sseDiv?.classList.contains('min-w-0')).toBe(true);
    });
  });

  describe('header', () => {
    it('hides PREVIEW badge on small screens (hidden sm:inline-flex)', () => {
      renderLayout();

      const preview = screen.queryByText('PREVIEW');
      expect(preview).toBeDefined();
      expect(preview!.classList.contains('hidden')).toBe(true);
      expect(preview!.classList.contains('sm:inline-flex')).toBe(true);
    });

    it('hides Check updates button on mobile (hidden sm:inline-flex)', () => {
      renderLayout();

      const checkBtn = screen.queryByRole('button', { name: /Check updates/i });
      expect(checkBtn).toBeDefined();
      expect(checkBtn!.classList.contains('hidden')).toBe(true);
      expect(checkBtn!.classList.contains('sm:inline-flex')).toBe(true);
    });

    it('hides version label text on mobile inside header badge', () => {
      renderLayout();

      const header = document.querySelector('header');
      // The "Version X.Y.Z" span should be hidden sm:inline
      const versionSpans = header!.querySelectorAll('span');
      const versionLabel = Array.from(versionSpans).find(
        (span) => span.textContent?.startsWith('Version'),
      );
      expect(versionLabel).toBeDefined();
      expect(versionLabel!.classList.contains('hidden')).toBe(true);
      expect(versionLabel!.classList.contains('sm:inline')).toBe(true);
    });

    it('theme toggle button is always visible (no hidden class)', () => {
      renderLayout();

      const themeBtn = screen.getByRole('button', { name: /Switch to/i });
      expect(themeBtn).toBeDefined();
      expect(themeBtn.classList.contains('hidden')).toBe(false);
    });

    it('New Session button is always visible', () => {
      renderLayout();

      const newSessionBtn = screen.getByRole('button', { name: /New Session/i });
      expect(newSessionBtn).toBeDefined();
      expect(newSessionBtn.classList.contains('hidden')).toBe(false);
    });
  });

  describe('main content area', () => {
    it('uses responsive padding (p-3 sm:p-6 md:p-10)', () => {
      renderLayout();

      const main = screen.getByRole('main');
      expect(main.classList.contains('p-3')).toBe(true);
      expect(main.classList.contains('sm:p-6')).toBe(true);
      expect(main.classList.contains('md:p-10')).toBe(true);
    });
  });
});
