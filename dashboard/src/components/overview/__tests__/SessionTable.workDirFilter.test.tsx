/**
 * SessionTable.workDirFilter.test.tsx — Tests for workDir filtering in session table.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SessionTable from '../SessionTable';
import type { SessionStatusCounts } from '../../../types';

const mockGetSessions = vi.fn();
const mockGetSessionStatusCounts = vi.fn();
const mockGetAllSessionsHealth = vi.fn();

vi.mock('../../../api/client', () => ({
  getSessions: (...args: unknown[]) => mockGetSessions(...args),
  getSessionStatusCounts: (...args: unknown[]) => mockGetSessionStatusCounts(...args),
  getAllSessionsHealth: (...args: unknown[]) => mockGetAllSessionsHealth(...args),
  approve: vi.fn(),
  interrupt: vi.fn(),
  killSession: vi.fn(),
}));

vi.mock('../../../store/useToastStore', () => ({
  useToastStore: (selector: (state: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

const counts: SessionStatusCounts = {
  all: 3, idle: 2, working: 1, compacting: 0, context_warning: 0,
  waiting_for_input: 0, permission_prompt: 0, plan_mode: 0, ask_question: 0,
  bash_approval: 0, settings: 0, error: 0, rate_limit: 0, pending: 0,
  unknown: 0, killed: 0, completed: 0, crashed: 0,
};

const multiDirSessions = {
  sessions: [
    { id: 's1', displayName: 'project-a', workDir: '/home/user/projects/a', status: 'idle', createdAt: Date.now() - 1000, lastActivity: Date.now() },
    { id: 's2', displayName: 'project-b', workDir: '/home/user/projects/b', status: 'working', createdAt: Date.now() - 1000, lastActivity: Date.now() },
    { id: 's3', displayName: 'project-a-2', workDir: '/home/user/projects/a', status: 'idle', createdAt: Date.now() - 1000, lastActivity: Date.now() },
  ],
  pagination: { page: 1, limit: 20, total: 3, totalPages: 1 },
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('SessionTable workDir filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessions.mockResolvedValue(multiDirSessions);
    mockGetSessionStatusCounts.mockResolvedValue(counts);
    mockGetAllSessionsHealth.mockResolvedValue({});
  });

  it('shows workDir filter when sessions have multiple directories', async () => {
    renderWithRouter(<SessionTable />);
    const filterSelect = await screen.findByLabelText('Filter by directory');
    expect(filterSelect).toBeTruthy();
    const options = within(filterSelect as HTMLElement).getAllByRole('option');
    expect(options.length).toBe(3); // All + a + b
  });

  it('does not show workDir filter when all sessions share one directory', async () => {
    mockGetSessions.mockResolvedValue({
      sessions: [
        { id: 's1', displayName: 'only-project', workDir: '/home/user/project', status: 'idle', createdAt: Date.now(), lastActivity: Date.now() },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    renderWithRouter(<SessionTable />);

    // Wait for loading to finish (look for any element from the loaded table)
    await waitFor(() => {
      expect(mockGetSessions).toHaveBeenCalled();
    });

    // Filter should NOT appear — only 1 unique directory
    expect(screen.queryByLabelText('Filter by directory')).toBeNull();
  });
});
