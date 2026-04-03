import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { SessionInfo, SessionStatusCounts } from '../types';

const mockGetSessions = vi.fn();
const mockGetSessionStatusCounts = vi.fn();
const mockGetAllSessionsHealth = vi.fn();
const mockApprove = vi.fn();
const mockInterrupt = vi.fn();
const mockKillSession = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../components/overview/StatusDot', () => ({
  default: ({ status }: { status: string }) => <span data-testid={`status-dot-${status}`} />,
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
    vi.unstubAllGlobals();
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
});
