import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditPage from '../pages/AuditPage';

const mockFetchAuditLogs = vi.fn();

vi.mock('../api/client', () => ({
  fetchAuditLogs: (...args: unknown[]) => mockFetchAuditLogs(...args),
}));

const mockRecords = [
  {
    id: 'audit-1',
    ts: '2026-04-09T10:00:00Z',
    actor: 'key-abc123',
    action: 'create',
    sessionId: 'sess-1',
    detail: 'Created session "build-agent"',
  },
  {
    id: 'audit-2',
    ts: '2026-04-09T10:05:00Z',
    actor: 'key-def456',
    action: 'send',
    sessionId: 'sess-1',
    detail: 'Sent message to session',
  },
  {
    id: 'audit-3',
    ts: '2026-04-09T10:10:00Z',
    actor: 'key-abc123',
    action: 'kill',
    sessionId: 'sess-2',
    detail: undefined,
  },
];

const emptyResponse = { records: [], total: 0, page: 1, pageSize: 10 };

function renderPage(): void {
  render(
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>,
  );
}

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders table headers', async () => {
    mockFetchAuditLogs.mockResolvedValue({ ...emptyResponse, records: mockRecords, total: 3 });
    renderPage();
    await waitFor(() => {
      const headers = screen.getAllByRole('columnheader');
      expect(headers.map((h) => h.textContent)).toEqual(['Timestamp', 'Actor', 'Action', 'Session ID', 'Detail']);
    });
  });

  it('renders empty state when no records', async () => {
    mockFetchAuditLogs.mockResolvedValue(emptyResponse);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No audit records found')).toBeDefined();
    });
  });

  it('renders loading skeleton', () => {
    mockFetchAuditLogs.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders error state with retry button', async () => {
    mockFetchAuditLogs.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Failed to load audit logs')).toBeDefined();
      expect(screen.getByText('Retry')).toBeDefined();
    });
  });

  it('shows 404 message when endpoint is not implemented', async () => {
    const error = new Error('HTTP 404') as Error & { statusCode: number };
    error.statusCode = 404;
    mockFetchAuditLogs.mockRejectedValue(error);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Audit endpoint not available yet')).toBeDefined();
    });
  });

  it('renders pagination controls when records exist', async () => {
    mockFetchAuditLogs.mockResolvedValue({ records: mockRecords, total: 3, page: 1, pageSize: 10 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('3 records')).toBeDefined();
      expect(screen.getByLabelText('Previous page')).toBeDefined();
      expect(screen.getByLabelText('Next page')).toBeDefined();
    });
  });

  it('disables previous button on first page', async () => {
    mockFetchAuditLogs.mockResolvedValue({ records: mockRecords, total: 3, page: 1, pageSize: 10 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Previous page').hasAttribute('disabled')).toBe(true);
    });
  });

  it('renders audit records with action badges', async () => {
    mockFetchAuditLogs.mockResolvedValue({ records: mockRecords, total: 3, page: 1, pageSize: 10 });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('key-abc123').length).toBe(2);
      // Actions appear in both the select dropdown and the table badges
      expect(screen.getAllByText('create').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('send').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('kill').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('navigates to next page when Next is clicked', async () => {
    mockFetchAuditLogs
      .mockResolvedValueOnce({ records: mockRecords, total: 15, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ records: mockRecords.slice(0, 1), total: 15, page: 2, pageSize: 10 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Page 1 of 2')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => {
      expect(screen.getByText('Page 2 of 2')).toBeDefined();
    });
  });

  it('applies filters and resets to page 1', async () => {
    mockFetchAuditLogs.mockResolvedValue(emptyResponse);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No audit records found')).toBeDefined();
    });
    const actorInput = screen.getByPlaceholderText('e.g. key-abc123');
    fireEvent.change(actorInput, { target: { value: 'key-abc123' } });
    fireEvent.click(screen.getByText('Apply'));
    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'key-abc123', page: 1 }),
      );
    });
  });
});
