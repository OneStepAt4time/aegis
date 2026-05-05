import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionDetailPage from '../pages/SessionDetailPage';
import type { SessionHealth, SessionInfo } from '../types';

const mockGetScreenshot = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    getScreenshot: (...args: unknown[]) => mockGetScreenshot(...args),
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

vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (store: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

const session: SessionInfo = {
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

const health: SessionHealth = {
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
};

vi.mock('../hooks/useSessionPolling', () => ({
  useSessionPolling: () => ({
    session,
    health,
    notFound: false,
    loading: false,
    metrics: null,
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
  ApprovalBanner: () => <div>Approval</div>,
}));

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/sessions/session-1']}>
      <Routes>
        <Route path="/sessions/:id" element={<SessionDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Issue 319 screenshot capture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures and renders screenshot preview inline', async () => {
    mockGetScreenshot.mockResolvedValue({
      image: 'data:image/png;base64,ZmFrZQ==',
      mimeType: 'image/png',
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));

    await waitFor(() => {
      expect(mockGetScreenshot).toHaveBeenCalledWith('session-1');
      expect(screen.getByAltText('Session screenshot preview')).toBeDefined();
    });

    expect(mockAddToast).toHaveBeenCalledWith('success', 'Screenshot captured');
  });

  it('disables screenshot feature when backend reports unsupported', async () => {
    const err = Object.assign(new Error('Not implemented'), { statusCode: 501 });
    mockGetScreenshot.mockRejectedValue(err);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        'warning',
        'Screenshot unavailable',
        'Playwright is not installed on the server.',
      );
    });

    expect(screen.queryByRole('button', { name: 'Screenshot' })).toBeNull();
  });
});
