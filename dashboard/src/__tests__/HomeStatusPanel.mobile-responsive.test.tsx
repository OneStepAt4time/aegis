/**
 * HomeStatusPanel.mobile-responsive.test.tsx — Tests for 375px responsive fixes.
 *
 * Verifies that StatusCard uses responsive icon sizes, gaps, and text sizing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeStatusPanel from '../components/overview/HomeStatusPanel';
import { useStore } from '../store/useStore';

const mockGetHealth = vi.fn();

vi.mock('../api/client', () => ({
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

function makeHealth(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'ok',
    version: '0.5.3-alpha',
    platform: 'win32',
    uptime: 120,
    sessions: { active: 1, total: 3 },
    tmux: { healthy: true, error: null },
    claude: { available: true, healthy: true, version: '2.1.90', minimumVersion: '2.1.80', error: null },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('HomeStatusPanel mobile responsive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useStore.setState({ activities: [], sseConnected: false, sseError: null });
    mockGetHealth.mockResolvedValue(makeHealth());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('status card icon circle uses responsive sizing (h-8 w-8 sm:h-10 sm:w-10)', async () => {
    render(<MemoryRouter><HomeStatusPanel onCreateFirstSession={vi.fn()} /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    const card = screen.getByRole('article', { name: 'Tmux status: Ready' });
    const iconCircle = card.querySelector('div.rounded-full');

    expect(iconCircle).not.toBeNull();
    expect(iconCircle!.classList.contains('h-8')).toBe(true);
    expect(iconCircle!.classList.contains('w-8')).toBe(true);
    expect(iconCircle!.classList.contains('sm:h-10')).toBe(true);
    expect(iconCircle!.classList.contains('sm:w-10')).toBe(true);
  });

  it('status card value uses responsive font sizing (text-lg sm:text-xl)', async () => {
    render(<MemoryRouter><HomeStatusPanel onCreateFirstSession={vi.fn()} /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    const card = screen.getByRole('article', { name: 'Tmux status: Ready' });
    // The "Ready" value element
    const valueEl = card.querySelector('.font-mono.font-bold');
    expect(valueEl).not.toBeNull();
    expect(valueEl!.classList.contains('text-lg')).toBe(true);
    expect(valueEl!.classList.contains('sm:text-xl')).toBe(true);
  });

  it('status card icon row uses responsive gap (gap-3 sm:gap-4)', async () => {
    render(<MemoryRouter><HomeStatusPanel onCreateFirstSession={vi.fn()} /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    const card = screen.getByRole('article', { name: 'Tmux status: Ready' });
    // The row containing icon + label + value
    const row = card.querySelector('.flex.items-center');
    expect(row).not.toBeNull();
    expect(row!.classList.contains('gap-3')).toBe(true);
    expect(row!.classList.contains('sm:gap-4')).toBe(true);
  });

  it('degraded status card shows action button with responsive margin', async () => {
    mockGetHealth.mockResolvedValue(makeHealth({
      tmux: { healthy: false, error: 'tmux not running' },
    }));

    render(<MemoryRouter><HomeStatusPanel onCreateFirstSession={vi.fn()} /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    const card = screen.getByRole('article', { name: 'Tmux status: Degraded' });
    const actionBtn = card.querySelector('button');
    expect(actionBtn).not.toBeNull();
    expect(actionBtn!.classList.contains('ml-11')).toBe(true);
    expect(actionBtn!.classList.contains('sm:ml-14')).toBe(true);
  });
});
