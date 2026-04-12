import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsersPage from '../pages/UsersPage';

const fetchUsersMock = vi.fn();

vi.mock('../api/client', () => ({
  fetchUsers: (...args: unknown[]) => fetchUsersMock(...args),
}));

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders users returned by API', async () => {
    fetchUsersMock.mockResolvedValueOnce({
      count: 1,
      users: [
        {
          id: 'admin-main',
          name: 'Main Admin',
          role: 'admin',
          createdAt: Date.now() - 120_000,
          lastUsedAt: Date.now() - 60_000,
          expiresAt: null,
          rateLimit: 120,
          activeSessions: 3,
          totalSessionsCreated: 22,
          lastSessionAt: Date.now() - 30_000,
        },
      ],
    });

    render(<UsersPage />);

    expect(await screen.findByText('admin-main')).toBeDefined();
    expect(screen.getByText('Main Admin')).toBeDefined();
    expect(screen.getByText('120/min')).toBeDefined();
  });

  it('shows endpoint placeholder on 404', async () => {
    const err = new Error('not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    fetchUsersMock.mockRejectedValueOnce(err);

    render(<UsersPage />);

    expect(await screen.findByText('Users endpoint not available yet')).toBeDefined();
  });
});
