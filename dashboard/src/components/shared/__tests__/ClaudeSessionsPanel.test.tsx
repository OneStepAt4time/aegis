/**
 * ClaudeSessionsPanel tests — CC sessions discovery panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ClaudeSessionsPanel } from '../ClaudeSessionsPanel';

vi.mock('../../../api/client', () => ({
  getClaudeSessions: vi.fn(),
}));

vi.mock('../../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

import { getClaudeSessions } from '../../../api/client';
const mockGetClaudeSessions = vi.mocked(getClaudeSessions);

const workingSession = {
  pid: 12345,
  cwd: '/home/user/projects/aegis',
  kind: 'background' as const,
  startedAt: Date.now() - 300_000,
  sessionId: 'abc-123-def',
  name: 'abc-123',
  status: 'working' as const,
};

const idleSession = {
  pid: 67890,
  cwd: '/home/user/.openclaw/workspace-argus',
  kind: 'background' as const,
  startedAt: Date.now() - 7200_000,
  sessionId: 'xyz-456-uvw',
  name: 'xyz-456',
  status: 'idle' as const,
};

describe('ClaudeSessionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock setInterval to not actually run
    vi.spyOn(window, 'setInterval').mockReturnValue(999 as unknown as ReturnType<typeof setInterval>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading skeleton initially', () => {
    mockGetClaudeSessions.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ClaudeSessionsPanel pollInterval={999999} />);
    expect(container.querySelector('[class*="animate-shimmer"]')).not.toBeNull();
  });

  it('renders sessions after data loads', async () => {
    let resolvePromise!: (v: ClaudeAgentSession[]) => void;
    mockGetClaudeSessions.mockReturnValue(new Promise<ClaudeAgentSession[]>((r) => { resolvePromise = r; }));

    const { container } = render(<ClaudeSessionsPanel pollInterval={999999} />);
    // Loading skeleton visible
    expect(container.querySelector('[class*="animate-shimmer"]')).not.toBeNull();

    await act(async () => { resolvePromise!([workingSession, idleSession]); });
    // Session names should now be visible
    expect(screen.getByText('abc-123')).not.toBeNull();
    expect(screen.getByText('xyz-456')).not.toBeNull();
  });

  it('renders empty state when no sessions', async () => {
    let resolvePromise!: (v: ClaudeAgentSession[]) => void;
    mockGetClaudeSessions.mockReturnValue(new Promise<ClaudeAgentSession[]>((r) => { resolvePromise = r; }));

    render(<ClaudeSessionsPanel pollInterval={999999} />);
    await act(async () => { resolvePromise!([]); });
    expect(screen.getByText('No active CC sessions')).not.toBeNull();
  });

  it('hides panel when endpoint returns 404', async () => {
    let rejectPromise!: (e: Error) => void;
    const error = new Error('Not Found') as Error & { status?: number };
    error.status = 404;
    mockGetClaudeSessions.mockReturnValue(new Promise<never>((_, r) => { rejectPromise = r; }));

    render(<ClaudeSessionsPanel pollInterval={999999} />);
    await act(async () => { rejectPromise!(error); });
    // Panel returns null for 404
    expect(screen.queryByText('CC Sessions')).toBeNull();
  });

  it('shows error alert for non-404 errors', async () => {
    let rejectPromise!: (e: Error) => void;
    mockGetClaudeSessions.mockReturnValue(new Promise<never>((_, r) => { rejectPromise = r; }));

    render(<ClaudeSessionsPanel pollInterval={999999} />);
    await act(async () => { rejectPromise!(new Error('Network error')); });
    expect(screen.getByRole('alert')).not.toBeNull();
  });

  it('abbreviates home directory in cwd', async () => {
    let resolvePromise!: (v: ClaudeAgentSession[]) => void;
    mockGetClaudeSessions.mockReturnValue(new Promise<ClaudeAgentSession[]>((r) => { resolvePromise = r; }));

    render(<ClaudeSessionsPanel pollInterval={999999} />);
    await act(async () => { resolvePromise!([workingSession]); });
    expect(screen.getByText('~/projects/aegis')).not.toBeNull();
  });

  it('limits displayed sessions to maxItems', async () => {
    let resolvePromise!: (v: ClaudeAgentSession[]) => void;
    const manySessions = Array.from({ length: 50 }, (_, i) => ({
      ...workingSession,
      sessionId: `session-${i}`,
      name: `session-${i}`,
    }));
    mockGetClaudeSessions.mockReturnValue(new Promise<ClaudeAgentSession[]>((r) => { resolvePromise = r; }));

    render(<ClaudeSessionsPanel pollInterval={999999} maxItems={5} />);
    await act(async () => { resolvePromise!(manySessions); });
    // Header shows count = maxItems
    expect(screen.getByText('5')).not.toBeNull();
  });

  it('has accessible list with aria-label', async () => {
    let resolvePromise!: (v: ClaudeAgentSession[]) => void;
    mockGetClaudeSessions.mockReturnValue(new Promise<ClaudeAgentSession[]>((r) => { resolvePromise = r; }));

    render(<ClaudeSessionsPanel pollInterval={999999} />);
    await act(async () => { resolvePromise!([workingSession]); });
    expect(screen.getByRole('list', { name: /Claude Code sessions/ })).not.toBeNull();
  });
});
