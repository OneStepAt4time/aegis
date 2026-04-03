import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { SessionInfo } from '../types';

const statusDotRenderSpy = vi.fn();
const mockGetSessions = vi.fn();
const mockGetAllSessionsHealth = vi.fn();
const mockApprove = vi.fn();
const mockInterrupt = vi.fn();
const mockKillSession = vi.fn();

vi.mock('../components/overview/StatusDot', () => ({
  default: ({ status }: { status: string }) => {
    statusDotRenderSpy(status);
    return <span data-testid={`status-dot-${status}`} />;
  },
}));

vi.mock('../api/client', () => ({
  getSessions: (...args: unknown[]) => mockGetSessions(...args),
  getAllSessionsHealth: (...args: unknown[]) => mockGetAllSessionsHealth(...args),
  approve: (...args: unknown[]) => mockApprove(...args),
  interrupt: (...args: unknown[]) => mockInterrupt(...args),
  killSession: (...args: unknown[]) => mockKillSession(...args),
}));

import SessionTable from '../components/overview/SessionTable';

const baseSession: SessionInfo = {
  id: 's1',
  windowId: 'w1',
  windowName: 'alpha',
  workDir: '/tmp/alpha',
  status: 'idle',
  createdAt: Date.now(),
  lastActivity: Date.now(),
  stallThresholdMs: 300000,
  permissionMode: 'default',
  byteOffset: 0,
  monitorOffset: 0,
};

function renderTable() {
  return render(
    <MemoryRouter>
      <SessionTable />
    </MemoryRouter>,
  );
}

describe('SessionTable polling and memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useStore.setState({
      sessions: [],
      healthMap: {},
      sseConnected: false,
      sseError: null,
    });

    mockGetSessions.mockResolvedValue({ sessions: [baseSession] });
    mockGetAllSessionsHealth.mockResolvedValue({
      [baseSession.id]: { alive: true },
    });
    mockApprove.mockResolvedValue(undefined);
    mockInterrupt.mockResolvedValue(undefined);
    mockKillSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses fallback polling when SSE is disconnected', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    renderTable();

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(1);
    });

    const pollingCall = setIntervalSpy.mock.calls.find((call) => call[1] === 5_000);
    expect(pollingCall).toBeDefined();
    const intervalCallback = pollingCall?.[0] as () => void | Promise<void>;

    await act(async () => {
      await intervalCallback?.();
      await intervalCallback?.();
      await intervalCallback?.();
    });

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(4);
    });
  });

  it('does not run interval polling when SSE is connected', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    useStore.setState({ sseConnected: true });

    renderTable();

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(1);
    });

    const pollingCall = setIntervalSpy.mock.calls.find((call) => call[1] === 5_000);
    expect(pollingCall).toBeUndefined();
    expect(mockGetSessions).toHaveBeenCalledTimes(1);
  });

  it('memoizes rows so unrelated row action state changes do not rerender all rows', async () => {
    const secondSession: SessionInfo = {
      ...baseSession,
      id: 's2',
      windowId: 'w2',
      windowName: 'bravo',
      status: 'working',
      workDir: '/tmp/bravo',
    };

    useStore.setState({ sseConnected: true });
    mockGetSessions.mockResolvedValue({ sessions: [baseSession, secondSession] });
    mockGetAllSessionsHealth.mockResolvedValue({
      [baseSession.id]: { alive: true },
      [secondSession.id]: { alive: true },
    });

    const pendingInterrupt = new Promise<void>(() => {});
    mockInterrupt.mockReturnValue(pendingInterrupt);

    renderTable();

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
      expect(screen.getAllByText('bravo').length).toBeGreaterThan(0);
    });

    statusDotRenderSpy.mockClear();

    fireEvent.click(screen.getAllByTitle('Interrupt')[0]);

    await waitFor(() => {
      expect(mockInterrupt).toHaveBeenCalledTimes(1);
    });

    const rerenderedStatuses = statusDotRenderSpy.mock.calls.map((call) => call[0]);
    expect(rerenderedStatuses).toContain('idle');
    expect(rerenderedStatuses).not.toContain('working');
  });
});
