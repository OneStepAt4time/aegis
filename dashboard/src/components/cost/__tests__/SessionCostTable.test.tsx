/**
 * SessionCostTable tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SessionCostTable } from '../SessionCostTable';

vi.mock('../../../api/client', () => ({
  getSessionCost: vi.fn(),
}));

import { getSessionCost } from '../../../api/client';
import type { SessionCostEntry } from '../../../types';
const mockGetSessionCost = vi.mocked(getSessionCost);

const mockSession = {
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
};

const mockCost = {
  sessionId: 'session-123',
  totalInputTokens: 50000,
  totalOutputTokens: 10000,
  totalCacheCreationTokens: 2000,
  totalCacheReadTokens: 8000,
  cacheHitRate: 0.67,
  estimatedCostUsd: 1.25,
  model: 'claude-sonnet-4-20250514',
  burnRateUsdPerHour: 2.5,
  durationMinutes: 45,
  recordCount: 12,
};

describe('SessionCostTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session name and loading state initially', () => {
    mockGetSessionCost.mockReturnValue(new Promise(() => {}));
    render(<SessionCostTable sessions={[mockSession]} />);
    expect(screen.getByText('test-session')).not.toBeNull();
    expect(screen.getByText('Session Cost Breakdown')).not.toBeNull();
  });

  it('renders cost data after fetch', async () => {
    let resolve!: (v: SessionCostEntry) => void;
    mockGetSessionCost.mockReturnValue(new Promise<SessionCostEntry>((r) => { resolve = r; }));

    render(<SessionCostTable sessions={[mockSession]} />);
    await act(async () => { resolve!(mockCost as SessionCostEntry); });

    // $1.25 appears in both header total and row, use getAllByText
    expect(screen.getAllByText('$1.25').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('67%')).not.toBeNull();
  });

  it('renders model name', async () => {
    let resolve!: (v: SessionCostEntry) => void;
    mockGetSessionCost.mockReturnValue(new Promise<SessionCostEntry>((r) => { resolve = r; }));

    render(<SessionCostTable sessions={[mockSession]} />);
    await act(async () => { resolve!(mockCost as SessionCostEntry); });

    expect(screen.getByText('claude-sonnet-4-20250514')).not.toBeNull();
  });

  it('renders empty state when no sessions', () => {
    mockGetSessionCost.mockResolvedValue(null);
    render(<SessionCostTable sessions={[]} />);
    expect(screen.getByText('No sessions found')).not.toBeNull();
  });

  it('has accessible table with aria-label', () => {
    mockGetSessionCost.mockReturnValue(new Promise(() => {}));
    render(<SessionCostTable sessions={[mockSession]} />);
    expect(screen.getByRole('table', { name: /Session cost breakdown/ })).not.toBeNull();
  });

  it('has sortable column headers', () => {
    mockGetSessionCost.mockReturnValue(new Promise(() => {}));
    render(<SessionCostTable sessions={[mockSession]} />);
    expect(screen.getByRole('button', { name: /Sort by cost/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: /Sort by total tokens/ })).not.toBeNull();
  });

  it('shows total cost in header', async () => {
    let resolve!: (v: SessionCostEntry) => void;
    mockGetSessionCost.mockReturnValue(new Promise<SessionCostEntry>((r) => { resolve = r; }));

    render(<SessionCostTable sessions={[mockSession]} />);
    await act(async () => { resolve!(mockCost as SessionCostEntry); });

    // The header now renders "Total: " and "$1.25" in separate spans
    // $1.25 appears in both header and row, so use getAllByText
    const costElements = screen.getAllByText('$1.25');
    expect(costElements.length).toBeGreaterThanOrEqual(1);
    // Verify the total cost value is displayed in the header area
    const header = screen.getByText('Session Cost Breakdown').closest('div');
    expect(header!.textContent).toContain('Total:');
    expect(header!.textContent).toContain('$1.25');
  });
});
