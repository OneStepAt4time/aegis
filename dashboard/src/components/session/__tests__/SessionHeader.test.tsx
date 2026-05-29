/**
 * SessionHeader tests — session detail header with status, actions, and metadata.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionHeader } from '../SessionHeader';
import type { SessionInfo, SessionHealth } from '../../../types';

// ── Mocks ──────────────────────────────────────────────────

vi.mock('../../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

vi.mock('lucide-react', () => ({
  GitFork: (props: any) => <svg data-testid="icon-gitfork" {...props} />,
  MoreHorizontal: (props: any) => <svg data-testid="icon-more" {...props} />,
}));

vi.mock('../SessionStateBadge', () => ({
  SessionStateBadge: ({ status }: { status: string }) => (
    <span data-testid="session-state-badge">{status}</span>
  ),
  uiStateToSessionBadgeStatus: (uiState: string, alive: boolean) =>
    alive ? uiState : 'offline',
}));

vi.mock('../TimelineScrubber', () => ({
  TimelineScrubber: ({ events }: { events: any[] }) => (
    <div data-testid="timeline-scrubber">events:{events.length}</div>
  ),
}));

vi.mock('../../shared/HoldButton', () => ({
  HoldButton: ({ onConfirm, children, ...props }: any) => (
    <button data-testid="hold-button" onClick={onConfirm} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../../shared/CopyButton', () => ({
  CopyButton: ({ value }: { value: string }) => (
    <span data-testid="copy-button">{value}</span>
  ),
}));

vi.mock('../../shared/ModelBadge', () => ({
  ModelBadge: ({ model }: { model?: string }) => (
    <span data-testid="model-badge">{model ?? 'none'}</span>
  ),
}));

vi.mock('../../agents/AgentBadge', () => ({
  AgentBadge: ({ runnerName }: any) => (
    <span data-testid="agent-badge">{runnerName ?? 'none'}</span>
  ),
}));

vi.mock('../../shared/EffortIndicator', () => ({
  EffortIndicator: ({ effort }: any) => (
    <span data-testid="effort-indicator">{effort ?? 'none'}</span>
  ),
}));

vi.mock('../../shared/IsolationModeBadge', () => ({
  IsolationModeBadge: ({ isolationMode }: any) => (
    <span data-testid="isolation-badge">{isolationMode ?? 'none'}</span>
  ),
}));

vi.mock('../../../utils/formatSessionName', () => ({
  formatSessionName: (name: string) => name,
}));

// ── Fixtures ───────────────────────────────────────────────

const baseSession = {
  id: 'sess-abc123def456',
  displayName: 'My Test Session',
  workDir: '/home/user/projects/aegis',
  model: 'claude-sonnet-4-20250514',
  runnerName: 'claude-code',
  createdAt: Date.now() - 3600000,
  lastActivity: Date.now(),
  status: 'idle' as const,

  byteOffset: 0,
  monitorOffset: 0,
  stallThresholdMs: 30000,
  permissionMode: 'default',
} satisfies SessionInfo;

const baseHealth: SessionHealth = {

  alive: true,
  claudeRunning: true,
  status: 'idle' as const,
  hasTranscript: true,
  lastActivity: Date.now(),
  lastActivityAgo: 0,
  sessionAge: 3600000,
  details: '',
};

// ── Tests ──────────────────────────────────────────────────

describe('SessionHeader', () => {
  it('renders session display name', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.getByText('My Test Session')).not.toBeNull();
  });

  it('renders working directory', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    const dirEl = screen.getByText(/home\/user/);
    expect(dirEl).not.toBeNull();
  });

  it('renders SessionStateBadge', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.getByTestId('session-state-badge')).not.toBeNull();
  });

  it('renders Interrupt button', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.getByText('Interrupt')).not.toBeNull();
  });

  it('fires onInterrupt when Interrupt clicked', () => {
    const onInterrupt = vi.fn();
    render(
      <SessionHeader
        session={baseSession}
        health={baseHealth}
        onInterrupt={onInterrupt}
      />,
    );
    fireEvent.click(screen.getByText('Interrupt'));
    expect(onInterrupt).toHaveBeenCalledOnce();
  });

  it('shows Approve/Reject buttons when status is permission_prompt', () => {
    const health = { ...baseHealth, status: 'permission_prompt' as const };
    render(<SessionHeader session={baseSession} health={health} />);
    expect(screen.getByText('Approve')).not.toBeNull();
    expect(screen.getByText('Reject')).not.toBeNull();
  });

  it('shows Approve/Reject buttons when status is bash_approval', () => {
    const health = { ...baseHealth, status: 'bash_approval' as const };
    render(<SessionHeader session={baseSession} health={health} />);
    expect(screen.getByText('Approve')).not.toBeNull();
    expect(screen.getByText('Reject')).not.toBeNull();
  });

  it('hides Approve/Reject when status is idle', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });

  it('fires onApprove when Approve clicked', () => {
    const onApprove = vi.fn();
    const health = { ...baseHealth, status: 'permission_prompt' as const };
    render(
      <SessionHeader
        session={baseSession}
        health={health}
        onApprove={onApprove}
      />,
    );
    fireEvent.click(screen.getByText('Approve'));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('fires onReject when Reject clicked', () => {
    const onReject = vi.fn();
    const health = { ...baseHealth, status: 'permission_prompt' as const };
    render(
      <SessionHeader
        session={baseSession}
        health={health}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByText('Reject'));
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('renders overflow menu button', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.getByLabelText('More session actions')).not.toBeNull();
  });

  it('overflow menu opens and shows Save as Template when handler provided', () => {
    const onSaveTemplate = vi.fn();
    render(
      <SessionHeader
        session={baseSession}
        health={baseHealth}
        onSaveTemplate={onSaveTemplate}
      />,
    );
    fireEvent.click(screen.getByLabelText('More session actions'));
    expect(screen.getByText('Save as Template')).not.toBeNull();
  });

  it('overflow menu shows Fork option when handler provided', () => {
    const onFork = vi.fn();
    render(
      <SessionHeader
        session={baseSession}
        health={baseHealth}
        onFork={onFork}
      />,
    );
    fireEvent.click(screen.getByLabelText('More session actions'));
    expect(screen.getByText('Fork')).not.toBeNull();
  });

  it('overflow menu shows Kill Session via HoldButton when handler provided', () => {
    const onKill = vi.fn();
    render(
      <SessionHeader
        session={baseSession}
        health={baseHealth}
        onKill={onKill}
      />,
    );
    fireEvent.click(screen.getByLabelText('More session actions'));
    expect(screen.getByText('Kill Session')).not.toBeNull();
  });

  it('renders TimelineScrubber when timelineEvents provided', () => {
    render(
      <SessionHeader
        session={baseSession}
        health={baseHealth}
        timelineEvents={[{ type: 'message', timestamp: Date.now() } as any]}
      />,
    );
    expect(screen.getByTestId('timeline-scrubber')).not.toBeNull();
  });

  it('does not render TimelineScrubber when no events', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.queryByTestId('timeline-scrubber')).toBeNull();
  });

  it('renders ModelBadge', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.getByTestId('model-badge')).not.toBeNull();
  });

  it('renders AgentBadge', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.getByTestId('agent-badge')).not.toBeNull();
  });

  it('renders session ID with copy button', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.getByText(/ID:/)).not.toBeNull();
    expect(screen.getByTestId('copy-button')).not.toBeNull();
  });

  it('renders permission mode chip when set and not default', () => {
    const session = { ...baseSession, permissionMode: 'plan' };
    render(<SessionHeader session={session} health={baseHealth} />);
    expect(screen.getByText('plan')).not.toBeNull();
  });

  it('does not render permission mode chip when default', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.queryByText('default')).toBeNull();
  });

  it('shows CC session ID when claudeSessionId is present', () => {
    const session = { ...baseSession, claudeSessionId: 'cc-xyz789abc012' };
    render(<SessionHeader session={session} health={baseHealth} />);
    expect(screen.getByText(/Claude Code session/)).not.toBeNull();
  });

  it('does not show CC session ID when absent', () => {
    render(<SessionHeader session={baseSession} health={baseHealth} />);
    expect(screen.queryByText(/Claude Code session/)).toBeNull();
  });
});
