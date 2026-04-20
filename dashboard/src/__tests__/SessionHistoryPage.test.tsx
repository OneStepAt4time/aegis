import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SessionHistoryPage from '../pages/SessionHistoryPage';

const fetchSessionHistoryMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../api/client', () => ({
  fetchSessionHistory: (...args: unknown[]) => fetchSessionHistoryMock(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function renderPage(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SessionHistoryPage />
    </MemoryRouter>,
  );
}

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

    renderPage();

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

    renderPage();

    await screen.findByText('No session history records found');

    fireEvent.change(screen.getByLabelText('Owner key ID'), { target: { value: 'owner-1' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
    fireEvent.click(screen.getByText('Apply'));

    await waitFor(() => {
      expect(fetchSessionHistoryMock).toHaveBeenLastCalledWith(expect.objectContaining({
        ownerKeyId: 'owner-1',
        status: 'active',
        page: 1,
        limit: 25,
      }));
    });
  });

  it('navigates to session detail on row click', async () => {
    fetchSessionHistoryMock.mockResolvedValueOnce({
      records: [
        {
          id: 'sess-click',
          ownerKeyId: 'admin-main',
          createdAt: Date.now() - 5 * 60_000,
          lastSeenAt: Date.now() - 10_000,
          finalStatus: 'active',
          source: 'live',
        },
      ],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });

    renderPage();

    const row = await screen.findByText('sess-click');
    fireEvent.click(row);

    expect(navigateMock).toHaveBeenCalledWith('/sessions/sess-click');
  });
});
