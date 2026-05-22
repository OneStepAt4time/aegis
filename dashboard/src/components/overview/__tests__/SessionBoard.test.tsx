/**
 * SessionBoard tests — expanded coverage for #3991.
 *
 * Covers: column grouping logic, "Other" column, running/waiting counts,
 * session card data rendering, sorting, accessibility roles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { SessionBoard } from '../SessionBoard';

vi.mock('../../../api/client', () => ({
  getSessions: vi.fn(),
}));

import { getSessions } from '../../../api/client';
const mockGetSessions = vi.mocked(getSessions);

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-123',
    displayName: 'test-session',
    status: 'idle' as const,
    workDir: '/home/user/project',
    createdAt: Date.now() - 3600000,
    lastActivity: Date.now() - 60000,
    byteOffset: 0,
    monitorOffset: 0,
    stallThresholdMs: 300000,
    permissionMode: 'default',
    ...overrides,
  };
}

const emptyResponse = {
  sessions: [] as ReturnType<typeof makeSession>[],
  pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
};

describe('SessionBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Original tests ────────────────────────────────────────────────

  it('renders loading state', () => {
    mockGetSessions.mockReturnValue(new Promise(() => {}));
    render(<SessionBoard />);
    expect(screen.getByText('Loading sessions...')).not.toBeNull();
  });

  it('renders board columns after data loads', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'working' }),
        makeSession({ id: 's2', status: 'idle' }),
        makeSession({ id: 's3', status: 'permission_prompt' }),
      ],
      pagination: { page: 1, limit: 100, total: 3, totalPages: 1 },
    });

    render(<SessionBoard />);
    await waitFor(() => {
      expect(screen.getByText('Running')).not.toBeNull();
      expect(screen.getByText('Waiting')).not.toBeNull();
      expect(screen.getByText('Idle')).not.toBeNull();
    });
  });

  it('renders session cards with name and model', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'working', displayName: 'build-feature', model: 'claude-sonnet-4-20250514' }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);
    await waitFor(() => {
      expect(screen.getByText('build-feature')).not.toBeNull();
    });
  });

  it('shows needs-attention indicator for waiting sessions', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'permission_prompt' }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);
    await waitFor(() => {
      expect(screen.getByText('Needs attention')).not.toBeNull();
    });
  });

  it('renders error state', async () => {
    mockGetSessions.mockRejectedValue(new Error('Network error'));

    render(<SessionBoard />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load/)).not.toBeNull();
    });
  });

  it('shows correct session count', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [makeSession({ id: 's1' }), makeSession({ id: 's2' }), makeSession({ id: 's3' })],
      pagination: { page: 1, limit: 100, total: 3, totalPages: 1 },
    });

    render(<SessionBoard />);
    await waitFor(() => {
      expect(screen.getByText('3 sessions')).not.toBeNull();
    });
  });

  it('shows empty columns when no sessions match', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [makeSession({ id: 's1', status: 'idle' })],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);
    await waitFor(() => {
      const emptyTexts = screen.getAllByText('No sessions');
      expect(emptyTexts.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('has accessible board region', async () => {
    mockGetSessions.mockResolvedValue(emptyResponse);

    render(<SessionBoard />);
    await waitFor(() => {
      expect(screen.getByRole('region', { name: /Session board/ })).not.toBeNull();
    });
  });

  // ── #3991: Column grouping logic ──────────────────────────────────

  it('groups working sessions into the Running column', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's-running', status: 'working', displayName: 'runner' }),
        makeSession({ id: 's-idle', status: 'idle', displayName: 'sleeper' }),
      ],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });

    render(<SessionBoard />);

    const runningRegion = await screen.findByRole('region', { name: /Running sessions/ });
    expect(within(runningRegion).getByText('runner')).not.toBeNull();

    const idleRegion = await screen.findByRole('region', { name: /Idle sessions/ });
    expect(within(idleRegion).getByText('sleeper')).not.toBeNull();
  });

  it('groups permission_prompt into the Waiting column', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's-wait', status: 'permission_prompt', displayName: 'waiter' }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);

    const waitingRegion = await screen.findByRole('region', { name: /Waiting sessions/ });
    expect(within(waitingRegion).getByText('waiter')).not.toBeNull();
  });

  it('groups unknown statuses into Other column', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's-unknown', status: 'some_new_status' as string, displayName: 'mystery' }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);

    const otherRegion = await screen.findByRole('region', { name: /Other sessions/ });
    expect(within(otherRegion).getByText('mystery')).not.toBeNull();
  });

  it('does not render Other column when no sessions have unknown status', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'working' }),
        makeSession({ id: 's2', status: 'idle' }),
      ],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });

    render(<SessionBoard />);

    await screen.findByRole('region', { name: /Session board/ });
    expect(screen.queryByRole('region', { name: /Other sessions/ })).toBeNull();
  });

  it('shows correct running and waiting counts in header', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'working' }),
        makeSession({ id: 's2', status: 'compacting' }),
        makeSession({ id: 's3', status: 'permission_prompt' }),
        makeSession({ id: 's4', status: 'idle' }),
      ],
      pagination: { page: 1, limit: 100, total: 4, totalPages: 1 },
    });

    render(<SessionBoard />);

    await waitFor(() => {
      expect(screen.getByText(/2 running/)).not.toBeNull();
      expect(screen.getByText(/1 waiting/)).not.toBeNull();
      expect(screen.getByText('4 sessions')).not.toBeNull();
    });
  });

  it('renders session card aria-label with name and status', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'working', displayName: 'my-session' }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);

    const card = await screen.findByRole('article', { name: /my-session.*working/ });
    expect(card).not.toBeNull();
  });

  it('renders compacting status in Running column', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'compacting', displayName: 'compactor' }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);

    const runningRegion = await screen.findByRole('region', { name: /Running sessions/ });
    expect(within(runningRegion).getByText('compactor')).not.toBeNull();
  });

  it('renders ask_question status in Waiting column', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'ask_question', displayName: 'questioner' }),
      ],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);

    const waitingRegion = await screen.findByRole('region', { name: /Waiting sessions/ });
    expect(within(waitingRegion).getByText('questioner')).not.toBeNull();
  });

  it('sorts sessions within a column by lastActivity descending', async () => {
    const now = Date.now();
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's-old', status: 'working', displayName: 'older-session', lastActivity: now - 60000 }),
        makeSession({ id: 's-new', status: 'working', displayName: 'newer-session', lastActivity: now - 10000 }),
      ],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });

    render(<SessionBoard />);

    const runningRegion = await screen.findByRole('region', { name: /Running sessions/ });
    const cards = within(runningRegion).getAllByRole('listitem');
    expect(within(cards[0]).getByText('newer-session')).not.toBeNull();
    expect(within(cards[1]).getByText('older-session')).not.toBeNull();
  });

  it('renders all Waiting sub-statuses in Waiting column', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'bash_approval', displayName: 'bash-approval' }),
        makeSession({ id: 's2', status: 'context_warning', displayName: 'context-warn' }),
        makeSession({ id: 's3', status: 'waiting_for_input', displayName: 'wait-input' }),
      ],
      pagination: { page: 1, limit: 100, total: 3, totalPages: 1 },
    });

    render(<SessionBoard />);

    const waitingRegion = await screen.findByRole('region', { name: /Waiting sessions/ });
    expect(within(waitingRegion).getByText('bash-approval')).not.toBeNull();
    expect(within(waitingRegion).getByText('context-warn')).not.toBeNull();
    expect(within(waitingRegion).getByText('wait-input')).not.toBeNull();
  });

  // ── #3995: SSE-aware polling ──────────────────────────────────────

  it('calls getSessions on mount via polling hook', async () => {
    mockGetSessions.mockResolvedValue(emptyResponse);

    render(<SessionBoard />);

    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalled();
    });
  });
});

  // ── #3996: Pagination ─────────────────────────────────────────────

  it('shows "Load more" button when total exceeds loaded sessions', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'working' }),
        makeSession({ id: 's2', status: 'idle' }),
      ],
      pagination: { page: 1, limit: 100, total: 216, totalPages: 3 },
    });

    render(<SessionBoard />);

    const loadMoreBtn = await screen.findByRole('button', { name: /Load 214 more/ });
    expect(loadMoreBtn).not.toBeNull();
  });

  it('does not show "Load more" when all sessions are loaded', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [makeSession({ id: 's1' })],
      pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });

    render(<SessionBoard />);

    await waitFor(() => {
      expect(screen.getByText('1 sessions')).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: /Load.*more/ })).toBeNull();
  });

  it('shows total count in header when there are unloaded sessions', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [makeSession({ id: 's1' })],
      pagination: { page: 1, limit: 100, total: 50, totalPages: 1 },
    });

    render(<SessionBoard />);

    await waitFor(() => {
      // Shows total (50) not just loaded count (1)
      expect(screen.getByText(/50 sessions/)).not.toBeNull();
    });
  });

  it('shows loaded/total breakdown when hasMore', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [makeSession({ id: 's1' }), makeSession({ id: 's2' })],
      pagination: { page: 1, limit: 100, total: 216, totalPages: 3 },
    });

    render(<SessionBoard />);

    await waitFor(() => {
      expect(screen.getByText(/216 sessions \(2 loaded\)/)).not.toBeNull();
    });
  });

  it('does not show loaded breakdown when all sessions fit in one page', async () => {
    mockGetSessions.mockResolvedValue({
      ...emptyResponse,
      sessions: [makeSession({ id: 's1' }), makeSession({ id: 's2' })],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 1 },
    });

    render(<SessionBoard />);

    await waitFor(() => {
      // Just "2 sessions" without loaded breakdown
      expect(screen.getByText('2 sessions')).not.toBeNull();
    });
    expect(screen.queryByText(/loaded\)/)).toBeNull();
  });

  it('appends sessions when "Load more" is clicked', async () => {
    // First page
    mockGetSessions.mockResolvedValueOnce({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's1', status: 'working', displayName: 'first-page' }),
      ],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 2 },
    });

    // Second page
    mockGetSessions.mockResolvedValueOnce({
      ...emptyResponse,
      sessions: [
        makeSession({ id: 's2', status: 'idle', displayName: 'second-page' }),
      ],
      pagination: { page: 2, limit: 100, total: 2, totalPages: 2 },
    });

    render(<SessionBoard />);

    // Wait for first page
    await screen.findByText('first-page');

    // Click load more
    const loadMoreBtn = screen.getByRole('button', { name: /Load 1 more/ });
    fireEvent.click(loadMoreBtn);

    // Both sessions should be visible
    await waitFor(() => {
      expect(screen.getByText('first-page')).not.toBeNull();
      expect(screen.getByText('second-page')).not.toBeNull();
    });

    // "Load more" button should disappear
    expect(screen.queryByRole('button', { name: /Load.*more/ })).toBeNull();
  });

  it('shows loading spinner on "Load more" button while fetching', async () => {
    // First page resolves immediately
    mockGetSessions.mockResolvedValueOnce({
      ...emptyResponse,
      sessions: [makeSession({ id: 's1' })],
      pagination: { page: 1, limit: 100, total: 2, totalPages: 2 },
    });

    // Second page hangs
    mockGetSessions.mockReturnValueOnce(new Promise(() => {}));

    render(<SessionBoard />);

    const loadMoreBtn = await screen.findByRole('button', { name: /Load 1 more/ });
    fireEvent.click(loadMoreBtn);

    // Button should show loading state
    await waitFor(() => {
      expect(screen.getByText('Loading...')).not.toBeNull();
    });
  });
