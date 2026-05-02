import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditPage from '../pages/AuditPage';
import { I18nProvider } from '../i18n/context';

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
      <I18nProvider>
        <AuditPage />
      </I18nProvider>
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
      expect(screen.getAllByText('admin-key')[0]).toBeDefined();
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
      // Initial data fetch + integrity verification on mount
      expect(mockFetchAuditLogs).toHaveBeenCalledTimes(2);
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
      // Initial data fetch + integrity verification on mount
      expect(mockFetchAuditLogs).toHaveBeenCalledTimes(2);
    });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-04-17T11:00' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-04-17T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByText('From must be earlier than or equal to To.')).toBeDefined();
    // No additional fetch — count stays at 2
    expect(mockFetchAuditLogs).toHaveBeenCalledTimes(2);
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
      // Integrity verification call on mount
      .mockResolvedValueOnce(createAuditPageResponse())
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

    await act(async () => { fireEvent.click(screen.getByLabelText('Next page')); });

    await waitFor(() => {
      expect(mockFetchAuditLogs).toHaveBeenLastCalledWith(expect.objectContaining({
        cursor: 'cursor-page-2',
        limit: 25,
      }));
      expect(screen.getByText('Page 2 of 2')).toBeDefined();
    });
  });

  it('exports CSV and renders chain-integrity metadata from the response', async () => {
    // Default mock covers: initial data fetch + integrity verification + filtered fetch
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

    const exportCsvButton = screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement;
    await waitFor(() => {
      expect(exportCsvButton.disabled).toBe(false);
    });

    fireEvent.click(exportCsvButton);

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

  it('does not restart the live-tail interval when records change', async () => {
    mockFetchAuditLogs.mockResolvedValue(createAuditPageResponse());

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('3 records')).toBeDefined();
    });

    // Spy AFTER initial render so we only count post-mount interval activity.
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    // Enable live tail — should subscribe one 10s interval.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start live tail' }));
    });

    const liveTailIntervalsAfterStart = setIntervalSpy.mock.calls.filter(
      ([, ms]) => ms === 10_000,
    ).length;
    expect(liveTailIntervalsAfterStart).toBe(1);

    // Force the records list to change by refreshing with a new payload.
    // Before the fix, `records` was in the live-tail effect deps so any
    // change tore down + recreated the interval — the bug we're guarding.
    const newRecord = {
      ts: '2026-04-17T10:40:00.000Z',
      actor: 'admin-key',
      action: 'session.create',
      sessionId: '33333333-3333-3333-3333-333333333333',
      detail: 'Created session three',
      prevHash: 'hash-3',
      hash: 'hash-4',
    };
    mockFetchAuditLogs.mockResolvedValueOnce(
      createAuditPageResponse({ records: [newRecord, ...mockRecords], total: 4 }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('4 records')).toBeDefined();
    });

    const liveTailIntervalsAfterRefresh = setIntervalSpy.mock.calls.filter(
      ([, ms]) => ms === 10_000,
    ).length;
    expect(liveTailIntervalsAfterRefresh).toBe(liveTailIntervalsAfterStart);

    setIntervalSpy.mockRestore();
  });

  it('exports NDJSON with the applied filters', async () => {
    // Default mock covers: initial data fetch + integrity verification + filtered fetch
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

    const exportNdjsonButton = screen.getByRole('button', { name: 'Export NDJSON' }) as HTMLButtonElement;
    await waitFor(() => {
      expect(exportNdjsonButton.disabled).toBe(false);
    });

    fireEvent.click(exportNdjsonButton);

    await waitFor(() => {
      expect(mockExportAuditLogs).toHaveBeenCalledWith(expect.objectContaining({
        action: 'session.kill',
        format: 'ndjson',
        verify: true,
      }));
    });
  });
});
