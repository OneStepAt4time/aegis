import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SessionHistoryPage from '../pages/SessionHistoryPage';

const fetchSessionHistoryMock = vi.fn();

vi.mock('../api/client', () => ({
  fetchSessionHistory: (...args: unknown[]) => fetchSessionHistoryMock(...args),
}));

describe('SessionHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders rows from API response', async () => {
    fetchSessionHistoryMock.mockResolvedValueOnce({
      records: [
        {
          id: 'sess-001',
          ownerKeyId: 'admin-main',
          createdAt: Date.now() - 10 * 60_000,
          lastSeenAt: Date.now() - 30_000,
          finalStatus: 'active',
          source: 'audit+live',
        },
      ],
      pagination: {
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
      },
    });

    render(<SessionHistoryPage />);

    expect(await screen.findByText('sess-001')).toBeDefined();
    expect(screen.getByText('admin-main')).toBeDefined();
    expect(screen.getByText('audit+live')).toBeDefined();
  });

  it('applies filters and sends query params to API', async () => {
    fetchSessionHistoryMock.mockResolvedValue({
      records: [],
      pagination: {
        page: 1,
        limit: 25,
        total: 0,
        totalPages: 1,
      },
    });

    render(<SessionHistoryPage />);

    await screen.findByText('No session history records found');

    fireEvent.change(screen.getByLabelText('Owner key ID'), { target: { value: 'owner-1' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    fireEvent.click(screen.getByText('Apply'));

    expect(fetchSessionHistoryMock).toHaveBeenLastCalledWith(expect.objectContaining({
      ownerKeyId: 'owner-1',
      status: 'active',
      page: 1,
      limit: 25,
    }));
  });
});
