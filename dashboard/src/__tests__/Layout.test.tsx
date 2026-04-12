/**
 * Layout.test.tsx — Tests for Layout SSE error handling (#587) and sidebar.
 *
 * Verifies that if subscribeGlobalSSE throws synchronously, the component
 * survives (no crash), retries with exponential backoff, and shows error state.
 * Also tests sidebar collapse and mobile hamburger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, type RenderResult } from '@testing-library/react';
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

// Lazy import so mocks are in place
import Layout from '../components/Layout';
import { useSidebarStore } from '../store/useSidebarStore';

const UPDATE_CHECK_CACHE_KEY = 'aegis:update-check:v1';
const SIDEBAR_STORAGE_KEY = 'aegis-sidebar-collapsed';

function renderLayout(): RenderResult {
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

describe('Layout SSE error handling (#587)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    localStorage.removeItem(UPDATE_CHECK_CACHE_KEY);
    localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    useSidebarStore.setState({ isCollapsed: false, isMobileOpen: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  });

  it('renders without crashing when subscribeGlobalSSE succeeds', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    renderLayout();
    expect(screen.getByText('Aegis Dashboard')).toBeDefined();
    expect(mockSubscribeGlobalSSE).toHaveBeenCalled();
  });

  it('shows aegis version from health endpoint', async () => {
    vi.useRealTimers();
    mockSubscribeGlobalSSE.mockReturnValue(() => {});

    renderLayout();

    expect(await screen.findByText('Version 2.13.1')).toBeDefined();
    expect(mockGetHealth).toHaveBeenCalledTimes(1);
  });

  it('shows update available after check', async () => {
    vi.useRealTimers();
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    mockCheckForUpdates.mockResolvedValue({
      currentVersion: '2.13.1',
      latestVersion: '2.14.0',
      updateAvailable: true,
      releaseUrl: 'https://www.npmjs.com/package/@onestepat4time/aegis',
    });

    renderLayout();

    const button = await screen.findByRole('button', { name: 'Check updates' });
    await act(async () => {
      button.click();
    });

    expect(await screen.findByText('Update available: v2.14.0')).toBeDefined();
    expect(mockCheckForUpdates).toHaveBeenCalledWith('2.13.1');
  });

  it('runs update check automatically at startup', async () => {
    vi.useRealTimers();
    mockSubscribeGlobalSSE.mockReturnValue(() => {});

    renderLayout();

    expect(await screen.findByText('Up to date (v2.13.1)')).toBeDefined();
    expect(mockCheckForUpdates).toHaveBeenCalledWith('2.13.1');
  });

  it('uses cached update result within 12 hours', async () => {
    vi.useRealTimers();
    mockSubscribeGlobalSSE.mockReturnValue(() => {});

    localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify({
      currentVersion: '2.13.1',
      latestVersion: '2.14.0',
      updateAvailable: true,
      releaseUrl: 'https://www.npmjs.com/package/@onestepat4time/aegis',
      checkedAt: Date.now(),
      sourceVersion: '2.13.1',
    }));

    renderLayout();

    expect(await screen.findByText('Update available: v2.14.0')).toBeDefined();
    expect(mockCheckForUpdates).not.toHaveBeenCalled();
  });

  it('renders without crashing when subscribeGlobalSSE throws synchronously', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('Invalid URL construction');
    });

    // Should NOT throw — the component catches the error
    expect(() => renderLayout()).not.toThrow();
    expect(screen.getByText('Aegis Dashboard')).toBeDefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to subscribe to global SSE"),
      expect.any(Number),
      expect.any(Error),
    );
  });

  it('calls unsubscribe on cleanup', () => {
    const unsubscribe = vi.fn();
    mockSubscribeGlobalSSE.mockReturnValue(unsubscribe);

    const { unmount } = renderLayout();
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does not call unsubscribe on cleanup when subscribeGlobalSSE threw', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('boom');
    });

    const { unmount } = renderLayout();
    // Unmounting should not throw even though unsubscribe is undefined
    expect(() => unmount()).not.toThrow();
  });

  it('retries with exponential backoff when subscribeGlobalSSE throws', () => {
    const callCounts: number[] = [];
    mockSubscribeGlobalSSE.mockImplementation(() => {
      callCounts.push(callCounts.length + 1);
      throw new Error('Network error');
    });

    renderLayout();

    // First attempt happened immediately
    expect(callCounts).toHaveLength(1);

    // Advance past first retry delay (1s)
    act(() => { vi.advanceTimersByTime(1000); });
    expect(callCounts).toHaveLength(2);

    // Advance past second retry delay (2s)
    act(() => { vi.advanceTimersByTime(2000); });
    expect(callCounts).toHaveLength(3);

    // Advance past third retry delay (4s)
    act(() => { vi.advanceTimersByTime(4000); });
    expect(callCounts).toHaveLength(4);

    // Advance past fourth retry delay (8s)
    act(() => { vi.advanceTimersByTime(8000); });
    expect(callCounts).toHaveLength(5);

    // Fifth retry delay (16s) — last retry
    act(() => { vi.advanceTimersByTime(16000); });
    expect(callCounts).toHaveLength(6);

    // Should NOT retry beyond MAX_SSE_RETRIES (5 retries = 6 total attempts)
    act(() => { vi.advanceTimersByTime(32000); });
    expect(callCounts).toHaveLength(6);
  });

  it('shows error indicator after all retries exhausted', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('Persistent failure');
    });

    renderLayout();

    // Exhaust all retries
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { vi.advanceTimersByTime(4000); });
    act(() => { vi.advanceTimersByTime(8000); });
    act(() => { vi.advanceTimersByTime(16000); });

    expect(screen.getByText('SSE Degraded')).toBeDefined();
  });

  it('shows reconnecting state and clears it on successful reconnection', () => {
    let capturedCallbacks: { onReconnecting?: (attempt: number, delay: number) => void; onOpen?: () => void } = {};
    mockSubscribeGlobalSSE.mockImplementation((_cb: unknown, _token: unknown, opts?: { onReconnecting?: (attempt: number, delay: number) => void; onOpen?: () => void }) => {
      capturedCallbacks = opts ?? {};
      return () => {};
    });

    renderLayout();

    act(() => {
      capturedCallbacks.onReconnecting?.(1, 1000);
    });

    expect(screen.getByText('SSE Reconnecting (retry 1)')).toBeDefined();

    act(() => {
      capturedCallbacks.onOpen?.();
    });

    expect(screen.queryByText('SSE Reconnecting (retry 1)')).toBeNull();
    expect(screen.getByText('SSE Live')).toBeDefined();
  });

  it('stops retrying when component unmounts', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('Network error');
    });

    const { unmount } = renderLayout();
    expect(mockSubscribeGlobalSSE).toHaveBeenCalledTimes(1);

    unmount();

    // Advance time — should NOT trigger more retries
    act(() => { vi.advanceTimersByTime(10000); });
    expect(mockSubscribeGlobalSSE).toHaveBeenCalledTimes(1);
  });

  it('passes onGiveUp callback to subscribeGlobalSSE', () => {
    let capturedCallbacks: { onGiveUp?: () => void } = {};
    mockSubscribeGlobalSSE.mockImplementation((_handler: unknown, _token: unknown, callbacks: { onGiveUp?: () => void }) => {
      capturedCallbacks = callbacks;
      return () => {};
    });

    renderLayout();

    // Simulate the ResilientEventSource giving up
    act(() => {
      capturedCallbacks.onGiveUp?.();
    });

    expect(screen.getByText('SSE Degraded')).toBeDefined();
  });

});

describe('Layout sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
    localStorage.removeItem(SIDEBAR_STORAGE_KEY);
    useSidebarStore.setState({ isCollapsed: false, isMobileOpen: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  });

  it('renders hamburger button for mobile menu', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});

    renderLayout();

    expect(screen.getByRole('button', { name: 'Open menu' })).toBeDefined();
  });

  it('renders collapse toggle button', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});

    renderLayout();

    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeDefined();
  });

  it('applies collapsed width class when sidebar is collapsed', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    useSidebarStore.setState({ isCollapsed: true });

    renderLayout();

    const sidebar = document.querySelector('aside');
    expect(sidebar?.classList.contains('w-16')).toBe(true);
    expect(sidebar?.classList.contains('w-56')).toBe(false);
  });

  it('applies expanded width class when sidebar is not collapsed', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    useSidebarStore.setState({ isCollapsed: false });

    renderLayout();

    const sidebar = document.querySelector('aside');
    expect(sidebar?.classList.contains('w-56')).toBe(true);
    expect(sidebar?.classList.contains('w-16')).toBe(false);
  });

  it('hides nav labels when sidebar is collapsed', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    useSidebarStore.setState({ isCollapsed: true });

    renderLayout();

    // Labels should not be visible; icons should still render
    expect(screen.queryByText('Overview')).toBeNull();
    expect(screen.queryByText('Pipelines')).toBeNull();
  });

  it('shows nav labels when sidebar is expanded', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    useSidebarStore.setState({ isCollapsed: false });

    renderLayout();

    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Pipelines')).toBeDefined();
  });

  it('sets title attribute on collapsed nav links', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    useSidebarStore.setState({ isCollapsed: true });

    renderLayout();

    const overviewLink = screen.getByTitle('Overview');
    expect(overviewLink).toBeDefined();
  });
});
