import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionDetailPage from '../pages/SessionDetailPage';

const mockUseSessionPolling = vi.fn();
const mockSendMessage = vi.fn();
const mockSendCommand = vi.fn();
const mockSendBash = vi.fn();
const mockApprove = vi.fn();
const mockReject = vi.fn();
const mockInterrupt = vi.fn();
const mockEscape = vi.fn();
const mockKillSession = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../hooks/useSessionPolling', () => ({
  useSessionPolling: (...args: unknown[]) => mockUseSessionPolling(...args),
}));

vi.mock('../api/client', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  sendCommand: (...args: unknown[]) => mockSendCommand(...args),
  sendBash: (...args: unknown[]) => mockSendBash(...args),
  approve: (...args: unknown[]) => mockApprove(...args),
  reject: (...args: unknown[]) => mockReject(...args),
  interrupt: (...args: unknown[]) => mockInterrupt(...args),
  escape: (...args: unknown[]) => mockEscape(...args),
  killSession: (...args: unknown[]) => mockKillSession(...args),
}));

vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (state: { addToast: typeof mockAddToast }) => unknown) => selector({ addToast: mockAddToast }),
}));

vi.mock('../components/session/SessionHeader', () => ({
  SessionHeader: () => <div data-testid="session-header">header</div>,
}));

vi.mock('../components/session/TranscriptViewer', () => ({
  TranscriptViewer: () => <div data-testid="transcript-viewer">transcript</div>,
}));

vi.mock('../components/session/LiveTerminal', () => ({
  LiveTerminal: () => <div data-testid="live-terminal">terminal</div>,
}));

vi.mock('../components/session/SessionMetricsPanel', () => ({
  SessionMetricsPanel: () => <div data-testid="session-metrics">metrics</div>,
}));

vi.mock('../components/session/ApprovalBanner', () => ({
  ApprovalBanner: () => <div data-testid="approval-banner">approval</div>,
}));
vi.mock('../components/session/SessionSummaryCard', () => ({
  SessionSummaryCard: () => null,
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

describe('SessionDetailPage quick actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSendMessage.mockResolvedValue({ ok: true });
    mockSendCommand.mockResolvedValue({ ok: true });
    mockSendBash.mockResolvedValue({ ok: true });
    mockApprove.mockResolvedValue({ ok: true });
    mockReject.mockResolvedValue({ ok: true });
    mockInterrupt.mockResolvedValue({ ok: true });
    mockEscape.mockResolvedValue({ ok: true });
    mockKillSession.mockResolvedValue({ ok: true });

    mockUseSessionPolling.mockReturnValue({
      loading: false,
      notFound: false,
      session: {
        id: 'session-1',
        windowId: '@1',
        windowName: 'Session One',
        workDir: '/repo/project',
        status: 'idle',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        stallThresholdMs: 300000,
        permissionMode: 'default',
        byteOffset: 0,
        monitorOffset: 0,
      },
      health: {
        alive: true,
        windowExists: true,
        claudeRunning: true,
        paneCommand: 'claude',
        status: 'idle',
        hasTranscript: true,
        lastActivity: Date.now(),
        lastActivityAgo: 0,
        sessionAge: 1000,
        details: '',
      },
      metrics: null,
      metricsLoading: false,
      summary: null,
      summaryLoading: false,
    });
  });

  it('inserts the selected slash command into the message input', () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Common slash command'), {
      target: { value: '/config' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Insert Slash' }));

    expect((screen.getByPlaceholderText('Send a message to Claude…') as HTMLInputElement).value).toBe('/config');
  });

  it('sends the selected slash command immediately', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Common slash command'), {
      target: { value: '/compact' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run Slash' }));

    await waitFor(() => {
      expect(mockSendCommand).toHaveBeenCalledWith('session-1', '/compact');
    });
  });

  it('requires explicit confirmation before sending a bash command', async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText('Bash command'), {
      target: { value: 'pwd' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review Bash' }));

    expect(mockSendBash).not.toHaveBeenCalled();
    expect(screen.getByText('Confirm bash command execution.')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Bash' }));

    await waitFor(() => {
      expect(mockSendBash).toHaveBeenCalledWith('session-1', 'pwd');
    });
  });
});