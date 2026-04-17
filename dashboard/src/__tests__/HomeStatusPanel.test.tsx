import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HomeStatusPanel from '../components/overview/HomeStatusPanel';
import { useStore } from '../store/useStore';
import type { GlobalSSEEvent } from '../types';

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
    sessions: {
      active: 0,
      total: 0,
    },
    tmux: {
      healthy: true,
      error: null,
    },
    claude: {
      available: true,
      healthy: true,
      version: '2.1.90',
      minimumVersion: '2.1.80',
      error: null,
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('HomeStatusPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useStore.setState({
      activities: [],
      sseConnected: false,
      sseError: null,
    });
    mockGetHealth.mockResolvedValue(makeHealth());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders tmux, Claude CLI, and active session cards', async () => {
    render(<HomeStatusPanel onCreateFirstSession={vi.fn()} />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(screen.getByRole('article', { name: 'Tmux status: Ready' })).toBeDefined();
    expect(screen.getByRole('article', { name: 'Claude CLI: Ready' })).toBeDefined();
    expect(screen.getByRole('article', { name: 'Active sessions: 0' })).toBeDefined();
    expect(screen.getByText('Claude CLI 2.1.90 is available.')).toBeDefined();
  });

  it('shows a create first session CTA when no sessions exist', async () => {
    const onCreateFirstSession = vi.fn();

    render(<HomeStatusPanel onCreateFirstSession={onCreateFirstSession} />);

    await act(async () => {
      await vi.runAllTicks();
    });

    const button = screen.getByRole('button', { name: 'Create first session' });
    fireEvent.click(button);

    expect(button).toBeDefined();
    expect(onCreateFirstSession).toHaveBeenCalledTimes(1);
  });

  it('hides the onboarding CTA after sessions have been created', async () => {
    mockGetHealth.mockResolvedValue(makeHealth({
      sessions: {
        active: 2,
        total: 5,
      },
    }));

    render(<HomeStatusPanel onCreateFirstSession={vi.fn()} />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(screen.queryByRole('button', { name: 'Create first session' })).toBeNull();
    expect(screen.getByRole('article', { name: 'Active sessions: 2' })).toBeDefined();
  });

  it('refreshes status cards via polling without a full page reload', async () => {
    mockGetHealth
      .mockResolvedValueOnce(makeHealth({
        sessions: {
          active: 0,
          total: 0,
        },
      }))
      .mockResolvedValueOnce(makeHealth({
        sessions: {
          active: 3,
          total: 3,
        },
      }));

    render(<HomeStatusPanel onCreateFirstSession={vi.fn()} />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(screen.getByRole('article', { name: 'Active sessions: 0' })).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.runAllTicks();
    });

    expect(mockGetHealth).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('article', { name: 'Active sessions: 3' })).toBeDefined();
  });

  it('debounces SSE-driven refreshes while connected', async () => {
    useStore.setState({ sseConnected: true, activities: [] });
    mockGetHealth
      .mockResolvedValueOnce(makeHealth({
        sessions: {
          active: 1,
          total: 1,
        },
      }))
      .mockResolvedValueOnce(makeHealth({
        sessions: {
          active: 2,
          total: 2,
        },
      }));

    render(<HomeStatusPanel onCreateFirstSession={vi.fn()} />);

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetHealth).toHaveBeenCalledTimes(1);

    const event: GlobalSSEEvent = {
      event: 'session_message',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      data: { text: 'hello' },
    };

    await act(async () => {
      useStore.getState().addActivity(event);
      await vi.advanceTimersByTimeAsync(999);
    });

    expect(mockGetHealth).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTicks();
    });

    expect(mockGetHealth).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('article', { name: 'Active sessions: 2' })).toBeDefined();
  });
});
