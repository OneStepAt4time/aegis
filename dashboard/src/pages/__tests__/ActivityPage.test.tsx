/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ActivityPage from '../ActivityPage';

// Mock the API client
vi.mock('../../api/client', () => ({
  fetchSessionHistory: vi.fn(),
}));

// Mock i18n
vi.mock('../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

// Mock child components that make their own API calls
vi.mock('../../components/overview/MetricCards', () => ({
  default: () => <div data-testid="metric-cards">MetricCards</div>,
}));
vi.mock('../../components/LiveAuditStream', () => ({
  default: () => <div data-testid="live-audit">LiveAuditStream</div>,
}));
vi.mock('../../components/shared/LiveStatusIndicator', () => ({
  default: () => <span data-testid="live-status">●</span>,
}));
vi.mock('../../components/shared/ClaudeSessionsPanel', () => ({
  ClaudeSessionsPanel: () => <div data-testid="claude-sessions">ClaudeSessions</div>,
}));
vi.mock('../../components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/analytics/HeatmapGrid', () => ({
  HeatmapGrid: () => <div data-testid="heatmap-grid">HeatmapGrid</div>,
}));

import { fetchSessionHistory } from '../../api/client';
const mockFetchSessionHistory = vi.mocked(fetchSessionHistory);

describe('ActivityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while heatmap data loads', () => {
    mockFetchSessionHistory.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ActivityPage />);
    expect(screen.getByRole('heading', { name: 'Live Activity' })).not.toBeNull();
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('shows empty state when no heatmap data', async () => {
    mockFetchSessionHistory.mockResolvedValue({
      records: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
    });
    render(<ActivityPage />);
    await waitFor(() => {
      expect(screen.getByText('No session activity recorded yet')).not.toBeNull();
    });
  });

  it('shows error state with retry when heatmap fetch fails', async () => {
    mockFetchSessionHistory.mockRejectedValue(new Error('Network error'));
    render(<ActivityPage />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).not.toBeNull();
    });
    expect(screen.getByText('Retry')).not.toBeNull();
  });

  it('retries heatmap fetch when retry button clicked', async () => {
    mockFetchSessionHistory.mockRejectedValueOnce(new Error('Network error'));
    render(<ActivityPage />);

    await waitFor(() => {
      expect(screen.getByText('Network error')).not.toBeNull();
    });

    // Now make the next call succeed
    mockFetchSessionHistory.mockResolvedValue({
      records: [],
      pagination: { page: 1, limit: 25, total: 0, totalPages: 0 },
    });
    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('No session activity recorded yet')).not.toBeNull();
    });
  });

  it('shows heatmap grid when data loads successfully', async () => {
    mockFetchSessionHistory.mockResolvedValue({
      records: [{
        id: 'test-record-1',
        createdAt: Math.floor(Date.now() / 1000),
        lastSeenAt: 0,
        finalStatus: 'active',
        source: 'live',
      }],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });
    render(<ActivityPage />);
    await waitFor(() => {
      expect(screen.getByTestId('heatmap-grid')).not.toBeNull();
    });
  });
});
