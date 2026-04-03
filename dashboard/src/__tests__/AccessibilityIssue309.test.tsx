import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionTable from '../components/overview/SessionTable';
import StatusDot from '../components/overview/StatusDot';
import SessionDetailPage from '../pages/SessionDetailPage';
import { useStore } from '../store/useStore';
import type { SessionInfo, SessionHealth, SessionMetrics } from '../types';

const mockGetSessions = vi.fn();
const mockGetAllSessionsHealth = vi.fn();
const mockGetSessionStatusCounts = vi.fn();

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getSessions: (...args: unknown[]) => mockGetSessions(...args),
    getAllSessionsHealth: (...args: unknown[]) => mockGetAllSessionsHealth(...args),
    getSessionStatusCounts: (...args: unknown[]) => mockGetSessionStatusCounts(...args),
    sendMessage: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    interrupt: vi.fn(),
    escape: vi.fn(),
    killSession: vi.fn(),
    getSessionMessages: vi.fn(() => Promise.resolve({ messages: [] })),
    subscribeSSE: vi.fn(() => () => {}),
  };
});

vi.mock('../hooks/useSessionPolling', () => ({
  useSessionPolling: () => ({
    session: {
      id: 'session-1',
      windowId: 'window-1',
      windowName: 'Alpha',
      workDir: '/tmp/alpha',
      byteOffset: 0,
      monitorOffset: 0,
      status: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stallThresholdMs: 300000,
      permissionMode: 'default',
    } satisfies SessionInfo,
    health: {
      alive: true,
      windowExists: true,
      claudeRunning: true,
      paneCommand: 'claude',
      status: 'idle',
      hasTranscript: true,
      lastActivity: Date.now(),
      lastActivityAgo: 0,
      sessionAge: 0,
      details: 'ready',
    } satisfies SessionHealth,
    notFound: false,
    loading: false,
    metrics: null as SessionMetrics | null,
    metricsLoading: false,
  }),
}));

vi.mock('../components/session/SessionHeader', () => ({
  SessionHeader: () => <div>Session Header</div>,
}));

vi.mock('../components/session/TerminalPassthrough', () => ({
  TerminalPassthrough: () => <div>Terminal Passthrough</div>,
}));

vi.mock('../components/session/SessionMetricsPanel', () => ({
  SessionMetricsPanel: () => <div>Metrics</div>,
}));

vi.mock('../components/session/ApprovalBanner', () => ({
  ApprovalBanner: () => <div>Approval Banner</div>,
}));

const baseSession: SessionInfo = {
  id: 'session-1',
  windowId: 'window-1',
  windowName: 'Alpha',
  workDir: '/tmp/alpha',
  byteOffset: 0,
  monitorOffset: 0,
  status: 'idle',
  createdAt: Date.now(),
  lastActivity: Date.now(),
  stallThresholdMs: 300000,
  permissionMode: 'default',
};

describe('Issue 309 accessibility fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      sessions: [],
      healthMap: {},
    });
    mockGetSessions.mockResolvedValue({
      sessions: [baseSession],
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      },
    });
    mockGetAllSessionsHealth.mockResolvedValue({
      [baseSession.id]: { alive: true },
    });
    mockGetSessionStatusCounts.mockResolvedValue({
      all: 1,
      idle: 1,
      working: 0,
      compacting: 0,
      context_warning: 0,
      waiting_for_input: 0,
      permission_prompt: 0,
      plan_mode: 0,
      ask_question: 0,
      bash_approval: 0,
      settings: 0,
      error: 0,
      unknown: 0,
    });
  });

  it('exposes an accessible label for status dots', () => {
    render(<StatusDot status="working" />);

    expect(screen.getByRole('img', { name: 'Status: Working' })).toBeDefined();
  });

  it('does not nest action buttons inside session detail links', async () => {
    render(
      <MemoryRouter>
        <SessionTable />
      </MemoryRouter>,
    );

    const detailsLinks = await screen.findAllByRole('link', { name: 'Alpha' });

    await waitFor(() => {
      expect(detailsLinks.length).toBeGreaterThan(0);
      for (const detailsLink of detailsLinks) {
        expect(within(detailsLink).queryByRole('button')).toBeNull();
      }
    });
  });

  it('renders a labeled session message input', () => {
    render(
      <MemoryRouter initialEntries={['/sessions/session-1']}>
        <Routes>
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Session message input')).toBeDefined();
  });
});