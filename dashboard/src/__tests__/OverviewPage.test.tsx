/**
 * __tests__/OverviewPage.test.tsx — CCMeter-inspired overview page (#2815).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OverviewPage from '../pages/OverviewPage';

// Mock API
vi.mock('../api/client', () => ({
  getAnalyticsSummary: vi.fn().mockResolvedValue({
    sessionVolume: [],
    tokenUsageByModel: [],
    costTrends: [],
    topApiKeys: [],
    durationTrends: [],
    errorRates: { totalSessions: 0, failedSessions: 0, permissionPrompts: 0, approvals: 0, autoApprovals: 0, failureRate: 0 },
    generatedAt: new Date().toISOString(),
  }),
}));

// Mock hooks
vi.mock('../hooks/useSessionRealtimeUpdates', () => ({
  useSessionRealtimeUpdates: vi.fn(),
}));

// Mock store
vi.mock('../store/useStore', () => ({
  useStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel({ sseError: null })),
}));

// Mock i18n — resolves keys from the English catalog
vi.mock('../i18n/context', async () => {
  const { en } = await import('../i18n/en');
  const catalog: Record<string, string> = {};
  const flatten = (obj: any, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? prefix + '.' + k : k;
      if (typeof v === 'string') catalog[key] = v;
      else if (typeof v === 'object' && v !== null) flatten(v, key);
    }
  };
  flatten(en, '');
  return { useT: () => (key: string) => catalog[key] || key };
});

// Mock child components
vi.mock('../components/overview/HomeStatusPanel', () => ({
  default: () => <div data-testid="home-status">HomeStatusPanel</div>,
}));

vi.mock('../components/overview/SessionTable', () => ({
  default: ({ maxRows }: { maxRows: number }) => <div data-testid="session-table">Table:{maxRows}</div>,
}));

vi.mock('../components/CreateSessionModal', () => ({
  default: ({ open }: { open: boolean }) => open ? <div data-testid="create-modal">Modal</div> : null,
}));

vi.mock('../components/shared/LiveStatusIndicator', () => ({
  default: () => <span data-testid="live-indicator">●</span>,
}));

describe('OverviewPage (CCMeter redesign)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page title', () => {
    render(<OverviewPage />);
    expect(screen.getByText('Overview')).not.toBeNull();
  });

  it('renders New Session button', () => {
    render(<OverviewPage />);
    const btn = screen.getByRole('button', { name: /create new session/i });
    expect(btn).not.toBeNull();
  });

  it('renders keyboard shortcuts section', () => {
    const { container } = render(<OverviewPage />);
    // Keyboard shortcuts footer has kbd elements
    const kbds = container.querySelectorAll('kbd');
    expect(kbds.length).toBeGreaterThan(0);
  });

  it('renders heatmap placeholder zone', () => {
    render(<OverviewPage />);
    expect(screen.getByText(/Activity Heatmap/i)).not.toBeNull();
  });

  it('renders session table section', () => {
    render(<OverviewPage />);
    expect(screen.getByTestId('session-table')).not.toBeNull();
  });
});
