import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { GlobalSSEEvent, SessionInfo, SessionStatusCounts } from '../types';

const mockGetSessions = vi.fn();
const mockGetSessionStatusCounts = vi.fn();
const mockGetAllSessionsHealth = vi.fn();
const mockApprove = vi.fn();
const mockInterrupt = vi.fn();
const mockKillSession = vi.fn();
const mockAddToast = vi.fn();
const mockStatusDot = vi.fn(({ status }: { status: string }) => <span data-testid={`status-dot-${status}`} />);

vi.mock('../components/overview/StatusDot', () => ({
  default: (props: { status: string }) => mockStatusDot(props),
}));

vi.mock('../api/client', () => ({
  getSessions: (...args: unknown[]) => mockGetSessions(...args),
  getSessionStatusCounts: (...args: unknown[]) => mockGetSessionStatusCounts(...args),
  getAllSessionsHealth: (...args: unknown[]) => mockGetAllSessionsHealth(...args),
  approve: (...args: unknown[]) => mockApprove(...args),
  interrupt: (...args: unknown[]) => mockInterrupt(...args),
  killSession: (...args: unknown[]) => mockKillSession(...args),
}));

vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (state: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

import SessionTable from '../components/overview/SessionTable';

const counts: SessionStatusCounts = {
  all: 3,
  idle: 1,
  working: 1,
  compacting: 0,
  context_warning: 0,
  waiting_for_input: 0,
  permission_prompt: 1,
  plan_mode: 0,
  ask_question: 0,
  bash_approval: 0,
  settings: 0,
  error: 0,
  unknown: 0,
};

const sessions: SessionInfo[] = [
  {
    id: 's1',
    windowId: 'w1',
    windowName: 'alpha',
    workDir: '/tmp/alpha',
    status: 'idle',
    createdAt: 1,
    lastActivity: 2,
    stallThresholdMs: 300000,
    permissionMode: 'default',
    byteOffset: 0,
    monitorOffset: 0,
  },
  {
    id: 's2',
    windowId: 'w2',
    windowName: 'bravo',
    workDir: '/srv/bravo',
    status: 'working',
    createdAt: 3,
    lastActivity: 4,
    stallThresholdMs: 300000,
    permissionMode: 'default',
    byteOffset: 0,
    monitorOffset: 0,
  },
  {
    id: 's3',
    windowId: 'w3',
    windowName: 'charlie',
    workDir: '/opt/project-charlie',
    status: 'permission_prompt',
    createdAt: 5,
    lastActivity: 6,
    stallThresholdMs: 300000,
    permissionMode: 'acceptEdits',
    byteOffset: 0,
    monitorOffset: 0,
  },
];

function makeListResponse(nextSessions: SessionInfo[]) {
  return {
    sessions: nextSessions,
    pagination: {
      page: 1,
      limit: 20,
      total: nextSessions.length,
      totalPages: 1,
    },
  };
}

function renderTable() {
  return render(
    <MemoryRouter>
      <SessionTable />
    </MemoryRouter>,
  );
}

describe('SessionTable filtering, search, and bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useStore.setState({
      sessions: [],
      healthMap: {},
      activities: [],
      sseConnected: true,
      sseError: null,
    });

    mockGetSessions.mockResolvedValue(makeListResponse(sessions));
    mockGetSessionStatusCounts.mockResolvedValue(counts);
    mockGetAllSessionsHealth.mockResolvedValue({
      s1: { alive: true },
      s2: { alive: true },
      s3: { alive: false },
    });
    mockApprove.mockResolvedValue({ ok: true });
    mockInterrupt.mockResolvedValue({ ok: true });
    mockKillSession.mockResolvedValue({ ok: true });
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('backs off polling when SSE is connected', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    renderTable();

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetSessions).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 30_000)).toBe(true);
  });

  it('debounces SSE-driven session refreshes while connected', async () => {
    vi.useFakeTimers();

    renderTable();

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetSessions).toHaveBeenCalledTimes(1);
    expect(mockGetSessionStatusCounts).toHaveBeenCalledTimes(1);

    const event: GlobalSSEEvent = {
      event: 'session_status_change',
      sessionId: 's1',
      timestamp: new Date().toISOString(),
      data: { status: 'working' },
    };

    await act(async () => {
      useStore.getState().addActivity(event);
      useStore.getState().addActivity({ ...event, sessionId: 's2', timestamp: new Date(Date.now() + 1).toISOString() });
      useStore.getState().addActivity({ ...event, sessionId: 's3', timestamp: new Date(Date.now() + 2).toISOString() });
      await vi.advanceTimersByTimeAsync(999);
    });

    expect(mockGetSessions).toHaveBeenCalledTimes(1);
    expect(mockGetSessionStatusCounts).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await vi.runAllTicks();
    });

    expect(mockGetSessions).toHaveBeenCalledTimes(2);
    expect(mockGetSessionStatusCounts).toHaveBeenCalledTimes(2);
  });

  it('renders status counts and refetches when the status filter changes', async () => {
    renderTable();

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalledWith({ page: 1, limit: 20, status: undefined });
    });

    expect(screen.getByRole('button', { name: /Idle/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Working/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Permission Prompt/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'working' },
    });

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenLastCalledWith({ page: 1, limit: 20, status: 'working' });
    });
  });

  it('filters visible sessions by search term', async () => {
    renderTable();

    await waitFor(() => {
      expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
      expect(screen.getAllByText('bravo').length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByLabelText('Search sessions'), {
      target: { value: 'bravo' },
    });

    await waitFor(() => {
      expect(screen.queryByText('alpha')).toBeNull();
      expect(screen.getAllByText('bravo').length).toBeGreaterThan(0);
    });

    expect(mockGetSessions).toHaveBeenLastCalledWith({ page: 1, limit: 100, status: undefined });
  });

  it('interrupts all selected sessions from the bulk action bar', async () => {
    renderTable();

    await waitFor(() => {
      expect(screen.getAllByLabelText('Select session alpha').length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText('Select session bravo').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByLabelText('Select session alpha')[0]);
    fireEvent.click(screen.getAllByLabelText('Select session bravo')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt Selected' }));

    await waitFor(() => {
      expect(mockInterrupt).toHaveBeenCalledTimes(2);
    });

    expect(mockInterrupt).toHaveBeenCalledWith('s1');
    expect(mockInterrupt).toHaveBeenCalledWith('s2');
  });

  it('kills all selected sessions from the bulk action bar after confirmation', async () => {
    renderTable();

    await waitFor(() => {
      expect(screen.getAllByLabelText('Select session alpha').length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText('Select session charlie').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByLabelText('Select session alpha')[0]);
    fireEvent.click(screen.getAllByLabelText('Select session charlie')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Kill Selected' }));

    await waitFor(() => {
      expect(mockKillSession).toHaveBeenCalledTimes(2);
    });

    expect(mockKillSession).toHaveBeenCalledWith('s1');
    expect(mockKillSession).toHaveBeenCalledWith('s3');
    expect(globalThis.confirm).toHaveBeenCalled();
  });

  it('does not rerender unchanged rows on unrelated table state changes', async () => {
    renderTable();

    await waitFor(() => {
      expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
      expect(screen.getAllByText('bravo').length).toBeGreaterThan(0);
      expect(screen.getAllByText('charlie').length).toBeGreaterThan(0);
    });

    const baselineRenders = mockStatusDot.mock.calls.length;

    // Whitespace-only input keeps the deferred search query as an empty string,
    // so visible rows should remain unchanged.
    fireEvent.change(screen.getByLabelText('Search sessions'), {
      target: { value: '   ' },
    });

    await waitFor(() => {
      expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
    });

    expect(mockStatusDot.mock.calls.length).toBe(baselineRenders);
  });

  it('rerenders only affected rows when a single session selection changes', async () => {
    renderTable();

    await waitFor(() => {
      expect(screen.getAllByLabelText('Select session alpha').length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText('Select session bravo').length).toBeGreaterThan(0);
    });

    const baselineRenders = mockStatusDot.mock.calls.length;

    fireEvent.click(screen.getAllByLabelText('Select session alpha')[0]);

    await waitFor(() => {
      expect(screen.getByText(/1 session selected/i)).toBeTruthy();
    });

    // Alpha appears in both mobile and desktop row trees, so selecting alpha should
    // rerender exactly those two row instances.
    expect(mockStatusDot.mock.calls.length - baselineRenders).toBe(2);
  });

  it('shows an inline error panel when the initial session load fails', async () => {
    mockGetSessions.mockRejectedValue(new Error('backend unavailable'));

    renderTable();

    await waitFor(() => {
      expect(screen.getByText('Unable to load sessions: backend unavailable')).toBeTruthy();
    });

    expect(screen.queryByText('Loading sessions...')).toBeNull();
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('shows a polling fallback badge while SSE is degraded', async () => {
    useStore.setState({
      sseConnected: false,
      sseError: 'Real-time updates unavailable. Overview widgets are using fallback polling where available.',
    });

    renderTable();

    await waitFor(() => {
      expect(screen.getByText('Polling fallback')).toBeTruthy();
    });
  });
});
