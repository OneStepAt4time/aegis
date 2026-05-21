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
    let resolve: (v: unknown) => void;
    mockGetSessionCost.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<SessionCostTable sessions={[mockSession]} />);
    await act(async () => { resolve!(mockCost); });

    expect(screen.getByText('$1.25')).not.toBeNull();
    expect(screen.getByText('67%')).not.toBeNull();
  });

  it('renders model name', async () => {
    let resolve: (v: unknown) => void;
    mockGetSessionCost.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<SessionCostTable sessions={[mockSession]} />);
    await act(async () => { resolve!(mockCost); });

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
    let resolve: (v: unknown) => void;
    mockGetSessionCost.mockReturnValue(new Promise((r) => { resolve = r; }));

    render(<SessionCostTable sessions={[mockSession]} />);
    await act(async () => { resolve!(mockCost); });

    expect(screen.getByText('Total: $1.25')).not.toBeNull();
  });
});
