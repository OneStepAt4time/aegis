import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditPage from '../pages/AuditPage';

const mockFetchAuditLogs = vi.fn();
const mockExportAuditLogs = vi.fn();

vi.mock('../api/client', () => ({
  fetchAuditLogs: (...args: unknown[]) => mockFetchAuditLogs(...args),
  exportAuditLogs: (...args: unknown[]) => mockExportAuditLogs(...args),
}));

const mockRecords = [
  {
    ts: '2026-04-17T10:00:00.000Z',
    actor: 'admin-key',
    action: 'session.create',
    sessionId: '11111111-1111-1111-1111-111111111111',
    detail: 'Created session one',
    prevHash: '',
    hash: 'hash-1',
  },
  {
    ts: '2026-04-17T10:20:00.000Z',
    actor: 'admin-key',
    action: 'permission.approve',
    sessionId: '11111111-1111-1111-1111-111111111111',
    detail: 'Approved session one',
    prevHash: 'hash-1',
    hash: 'hash-2',
  },
  {
    ts: '2026-04-17T10:30:00.000Z',
    actor: 'viewer-key',
    action: 'session.kill',
    sessionId: '22222222-2222-2222-2222-222222222222',
    detail: 'Killed session two',
    prevHash: 'hash-2',
    hash: 'hash-3',
  },
];

function createAuditPageResponse(overrides?: {
  records?: typeof mockRecords;
  total?: number;
  filters?: {
    actor?: string;
    action?: string;
    sessionId?: string;
    from?: string;
    to?: string;
  };
  pagination?: {
    limit?: number;
    hasMore?: boolean;
    nextCursor?: string | null;
    reverse?: boolean;
  };
  chain?: {
    count?: number;
    firstHash?: string | null;
    lastHash?: string | null;
    badgeHash?: string | null;
    firstTs?: string | null;
    lastTs?: string | null;
  };
}) {
  const records = overrides?.records ?? mockRecords;
  const first = records[0];
  const last = records[records.length - 1];

  return {
    count: records.length,
    total: overrides?.total ?? records.length,
    records,
    filters: overrides?.filters ?? {},
    pagination: {
      limit: overrides?.pagination?.limit ?? 25,
      hasMore: overrides?.pagination?.hasMore ?? false,
      nextCursor: overrides?.pagination?.nextCursor ?? null,
      reverse: overrides?.pagination?.reverse ?? true,
    },
    chain: {
      count: overrides?.chain?.count ?? records.length,
      firstHash: overrides?.chain?.firstHash ?? first?.hash ?? null,
      lastHash: overrides?.chain?.lastHash ?? last?.hash ?? null,
      badgeHash: overrides?.chain?.badgeHash ?? 'badge-hash',
      firstTs: overrides?.chain?.firstTs ?? first?.ts ?? null,
      lastTs: overrides?.chain?.lastTs ?? last?.ts ?? null,
    },
    integrity: undefined,
  };
}

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

  it('renders filters, export actions, and audit records', async () => {
    mockFetchAuditLogs.mockResolvedValue(createAuditPageResponse());

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Audit Trail' })).toBeDefined();
      expect(screen.getByLabelText('Actor')).toBeDefined();
      expect(screen.getByLabelText('Action')).toBeDefined();
      expect(screen.getByLabelText('Session ID')).toBeDefined();
      expect(screen.getByLabelText('From')).toBeDefined();
      expect(screen.getByLabelText('To')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Export NDJSON' })).toBeDefined();
      expect(screen.getByText('admin-key')).toBeDefined();
      expect(screen.getByText('session.create')).toBeDefined();
    });
  });

  it('renders empty state when no records match', async () => {
    mockFetchAuditLogs.mockResolvedValue(createAuditPageResponse({ records: [], total: 0 }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No audit records found')).toBeDefined();
    });
  });

  it('shows a dedicated message when the endpoint is unavailable', async () => {
    const error = new Error('HTTP 404') as Error & { statusCode: number };
    error.statusCode = 404;
    mockFetchAuditLogs.mockRejectedValue(error);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Audit endpoint not available yet')).toBeDefined();
    });
  });

  it('applies actor, action, session, and time range filters with ISO timestamps', async () => {
    mockFetchAuditLogs.mockResolvedValue(createAuditPageResponse());

    renderPage();

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'admin-key ' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'session.kill' } });
    fireEvent.change(screen.getByLabelText('Session ID'), { target: { value: '22222222-2222-2222-2222-222222222222' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-17T10:15' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-04-17T10:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({
        actor: 'admin-key',
        action: 'session.kill',
        sessionId: '22222222-2222-2222-2222-222222222222',
        from: new Date('2026-04-17T10:15').toISOString(),
        to: new Date('2026-04-17T10:45').toISOString(),
        limit: 25,
      }));
    });
  });

  it('validates the time range before refetching', async () => {
    mockFetchAuditLogs.mockResolvedValue(createAuditPageResponse());

    renderPage();

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-17T11:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-04-17T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByText('From must be earlier than or equal to To.')).toBeDefined();
    expect(mockFetchAuditLogs).toHaveBeenCalledTimes(1);
  });

  it('uses cursor pagination metadata for the next page', async () => {
    mockFetchAuditLogs
      .mockResolvedValueOnce(createAuditPageResponse({
        total: 30,
        pagination: {
          limit: 25,
          hasMore: true,
          nextCursor: 'cursor-page-2',
        },
      }))
      .mockResolvedValueOnce(createAuditPageResponse({
        records: [mockRecords[2]],
        total: 30,
        pagination: {
          limit: 25,
          hasMore: false,
          nextCursor: null,
        },
      }));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 2')).toBeDefined();
    });

    fireEvent.click(screen.getByLabelText('Next page'));

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({
        cursor: 'cursor-page-2',
        limit: 25,
      }));
      expect(screen.getByText('Page 2 of 2')).toBeDefined();
    }, { timeout: 5000 });
  });

  it('exports CSV and renders chain-integrity metadata from the response', async () => {
    mockFetchAuditLogs.mockResolvedValue(createAuditPageResponse());
    mockExportAuditLogs.mockResolvedValue({
      filename: 'audit-export-2026-04-17.csv',
      format: 'csv',
      mimeType: 'text/csv; charset=utf-8',
      chain: {
        count: 2,
        firstHash: 'first-hash',
        lastHash: 'last-hash',
        badgeHash: 'badge-hash-export',
        firstTs: '2026-04-17T10:00:00.000Z',
        lastTs: '2026-04-17T10:30:00.000Z',
      },
      integrity: {
        valid: true,
        file: 'audit-2026-04-17.log',
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('3 records')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'admin-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({
        actor: 'admin-key',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(mockExportAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
        actor: 'admin-key',
        format: 'csv',
        verify: true,
      }));
      expect(screen.getByText('Latest export metadata')).toBeDefined();
      expect(screen.getByText('Integrity verified')).toBeDefined();
      expect(screen.getByText('badge-hash-export')).toBeDefined();
      expect(screen.getByText('audit-export-2026-04-17.csv · CSV')).toBeDefined();
    });
  });

  it('exports NDJSON with the applied filters', async () => {
    mockFetchAuditLogs.mockResolvedValue(createAuditPageResponse());
    mockExportAuditLogs.mockResolvedValue({
      filename: 'audit-export-2026-04-17.ndjson',
      format: 'ndjson',
      mimeType: 'application/x-ndjson; charset=utf-8',
      chain: {
        count: 1,
        firstHash: 'only-hash',
        lastHash: 'only-hash',
        badgeHash: 'ndjson-badge',
        firstTs: '2026-04-17T10:30:00.000Z',
        lastTs: '2026-04-17T10:30:00.000Z',
      },
      integrity: {
        valid: true,
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('3 records')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'session.kill' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({
        action: 'session.kill',
      }));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export NDJSON' }));

    await waitFor(() => {
      expect(mockExportAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
        action: 'session.kill',
        format: 'ndjson',
        verify: true,
      }));
    });
  });
});
