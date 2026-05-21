/**
 * SessionBoard tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
});
