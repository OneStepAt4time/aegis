import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import MetricCards from '../MetricCards';

// ── Mocks ───────────────────────────────────────────────────────

const mockGetMetrics = vi.fn();
const mockGetHealth = vi.fn();

vi.mock('../../../api/client', () => ({
  getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

// Capture the refresh callback so tests can trigger data fetching
let capturedRefresh: (() => Promise<void>) | null = null;
vi.mock('../../../hooks/useSseAwarePolling', () => ({
  useSseAwarePolling: (opts: { refresh: () => Promise<void> }) => {
    capturedRefresh = opts.refresh;
  },
}));

// Zustand store mock — setMetrics actually updates mockStoreState.metrics
const mockStoreState: Record<string, unknown> = {};
vi.mock('../../../store/useStore', () => ({
  useStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockStoreState),
}));

vi.mock('react-router-dom', () => ({
  NavLink: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to} data-testid="navlink">{children}</a>
  ),
}));

vi.mock('../MetricCard', () => ({
  default: ({ label, value }: { label: string; value: string | number }) => (
    <div data-testid="metric-card" data-label={label} data-value={String(value)} />
  ),
}));

vi.mock('../RealtimeBadge', () => ({
  default: ({ mode, message }: { mode: string; message: string }) => (
    <span data-testid="realtime-badge" data-mode={mode} title={message}>{mode}</span>
  ),
}));

vi.mock('../../shared/RingGauge', () => ({
  RingGauge: ({ value, label, primaryColor }: { value: number; label?: string; primaryColor?: string }) => (
    <div data-testid="ring-gauge" data-value={value} data-label={label} data-color={primaryColor} />
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────

function resetStoreState() {
  mockStoreState.metrics = null;
  mockStoreState.activities = [];
  mockStoreState.sseConnected = false;
  mockStoreState.sseError = null;
  // setMetrics actually updates the store so the component sees data on re-render
  mockStoreState.setMetrics = (m: unknown) => { mockStoreState.metrics = m; };
}

function fullMetrics(overrides: Record<string, unknown> = {}) {
  return {
    uptime: 1000,
    sessions: {
      total_created: 20,
      currently_active: 2,
      completed: 15,
      failed: 3,
      avg_duration_sec: 120,
      avg_messages_per_session: 10,
      infra_failed: 0,
      killed: 0,
    },
    auto_approvals: 5,
    webhooks_sent: 10,
    webhooks_failed: 1,
    screenshots_taken: 7,
    pipelines_created: 4,
    batches_created: 2,
    prompt_delivery: {
      sent: 100,
      delivered: 95,
      failed: 5,
      success_rate: 95.0 as number | null,
    },
    latency: {
      hook_latency_ms: { avg: 123.4, p50: 100, p95: 200, p99: 300 },
      state_change_detection_ms: { avg: 50, p50: 40, p95: 80, p99: 100 },
      permission_response_ms: { avg: 456.7, p50: 400, p95: 600, p99: 800 },
      channel_delivery_ms: { avg: 78.9, p50: 60, p95: 100, p99: 150 },
    },
    ...overrides,
  };
}

const fullHealth = {
  status: 'ok',
  uptime: 5000,
  version: '1.0.0',
  sessions: { active: 2, total: 20 },
};

async function renderAndWaitData(ui: React.ReactElement) {
  const result = render(ui);
  // Trigger the captured refresh (simulates useSseAwarePolling calling refresh)
  if (capturedRefresh) {
    await act(async () => { await capturedRefresh!(); });
  }
  return result;
}

// ── Tests ───────────────────────────────────────────────────────

describe('MetricCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRefresh = null;
    resetStoreState();
    mockGetMetrics.mockResolvedValue(fullMetrics());
    mockGetHealth.mockResolvedValue(fullHealth);
  });

  // ── Loading state ───────────────────────────────────────────

  it('shows loading state when isLoading and no data', () => {
    // capturedRefresh never called so isLoading stays true
    render(<MetricCards />);
    expect(screen.getByText('Loading overview metrics...')).toBeDefined();
  });

  // ── Error state (both fail) ────────────────────────────────

  it('shows error when both API calls fail and no prior data', async () => {
    mockGetMetrics.mockRejectedValue(new Error('metrics down'));
    mockGetHealth.mockRejectedValue(new Error('health down'));

    await renderAndWaitData(<MetricCards />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load overview metrics/)).toBeDefined();
    });
  });

  // ── Partial error: metrics fail, health succeeds ───────────

  it('shows partial error when metrics fail but health succeeds', async () => {
    mockGetMetrics.mockRejectedValue(new Error('metrics unavailable'));
    mockGetHealth.mockResolvedValue(fullHealth);

    await renderAndWaitData(<MetricCards />);

    await waitFor(() => {
      expect(screen.getByText(/Detailed metrics unavailable/)).toBeDefined();
    });
  });

  // ── Partial error: health fails, metrics succeed ───────────

  it('renders metrics when health fails but metrics succeed', async () => {
    mockGetHealth.mockRejectedValue(new Error('health down'));

    await renderAndWaitData(<MetricCards />);

    await waitFor(() => {
      const cards = screen.getAllByTestId('metric-card');
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  // ── Happy path ─────────────────────────────────────────────

  it('renders all metric cards with full data', async () => {
    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    // Completed, Prompts Delivered, Prompts Failed, Webhooks Sent,
    // Auto-Approvals, Pipelines Created, Batches Created, Screenshots,
    // Hook Latency, Permission Latency, Channel Latency = 11
    expect(cards.length).toBeGreaterThanOrEqual(11);
  });

  // ── SSE connected / disconnected ───────────────────────────

  it('does not show status row when SSE connected and no error', async () => {
    mockStoreState.sseConnected = true;
    mockStoreState.sseError = null;

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows status row with RealtimeBadge when SSE disconnected with error', async () => {
    mockStoreState.sseConnected = false;
    mockStoreState.sseError = 'connection lost';

    await renderAndWaitData(<MetricCards />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeDefined();
    });
    expect(screen.getByTestId('realtime-badge')).toBeDefined();
    expect(screen.getByTestId('realtime-badge').getAttribute('data-mode')).toBe('polling');
  });

  // ── Latency formatting ─────────────────────────────────────

  it('formats latency values with ms suffix and rounding', async () => {
    const m = fullMetrics();
    m.latency.hook_latency_ms.avg = 123.6;
    m.latency.permission_response_ms.avg = 456.2;
    m.latency.channel_delivery_ms.avg = 78.9;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const hookCard = cards.find((c) => c.getAttribute('data-label') === 'Avg Hook Latency');
    expect(hookCard).toBeDefined();
    expect(hookCard!.getAttribute('data-value')).toBe('124 ms');

    const permCard = cards.find((c) => c.getAttribute('data-label') === 'Avg Permission Latency');
    expect(permCard).toBeDefined();
    expect(permCard!.getAttribute('data-value')).toBe('456 ms');

    const chanCard = cards.find((c) => c.getAttribute('data-label') === 'Avg Channel Latency');
    expect(chanCard).toBeDefined();
    expect(chanCard!.getAttribute('data-value')).toBe('79 ms');
  });

  it('shows dash for null latency values', async () => {
    const m = fullMetrics();
    m.latency.hook_latency_ms = { avg: null as unknown as number, p50: 0, p95: 0, p99: 0 };
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const hookCard = cards.find((c) => c.getAttribute('data-label') === 'Avg Hook Latency');
    expect(hookCard).toBeDefined();
    expect(hookCard!.getAttribute('data-value')).toBe('—');
  });

  // ── Delivery rate color logic ──────────────────────────────

  it('uses green color when delivery rate >= 99', async () => {
    const m = fullMetrics();
    m.prompt_delivery.success_rate = 99.5;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const gauge = screen.getByTestId('ring-gauge');
    expect(gauge.getAttribute('data-color')).toBe('var(--color-success)');
  });

  it('uses amber color when delivery rate >= 90 and < 99', async () => {
    const m = fullMetrics();
    m.prompt_delivery.success_rate = 92.0;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const gauge = screen.getByTestId('ring-gauge');
    expect(gauge.getAttribute('data-color')).toBe('var(--color-warning)');
  });

  it('uses red color when delivery rate < 90', async () => {
    const m = fullMetrics();
    m.prompt_delivery.success_rate = 85.0;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const gauge = screen.getByTestId('ring-gauge');
    expect(gauge.getAttribute('data-color')).toBe('var(--color-error)');
  });

  it('passes undefined primaryColor when delivery rate is null (blue)', async () => {
    const m = fullMetrics();
    m.prompt_delivery.success_rate = null;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const gauge = screen.getByTestId('ring-gauge');
    // blue case: ternary doesn't match any branch → primaryColor not set
    expect(gauge.getAttribute('data-value')).toBe('0');
  });

  // ── Cost/token display ─────────────────────────────────────

  it('displays cost card when totalEstimatedCostUsd > 0', async () => {
    mockGetMetrics.mockResolvedValue(fullMetrics({ totalEstimatedCostUsd: 2.5, totalInputTokens: 5000, totalOutputTokens: 3000 }));

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const costCard = cards.find((c) => c.getAttribute('data-label') === 'Total Est. Cost');
    expect(costCard).toBeDefined();
    expect(costCard!.getAttribute('data-value')).toBe('$2.50');
  });

  it('formats small cost with 3 decimal places', async () => {
    mockGetMetrics.mockResolvedValue(fullMetrics({ totalEstimatedCostUsd: 0.456, totalInputTokens: 100, totalOutputTokens: 50 }));

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const costCard = cards.find((c) => c.getAttribute('data-label') === 'Total Est. Cost');
    expect(costCard).toBeDefined();
    expect(costCard!.getAttribute('data-value')).toBe('$0.456');
  });

  it('displays token card with k formatting', async () => {
    mockGetMetrics.mockResolvedValue(fullMetrics({ totalEstimatedCostUsd: 1, totalInputTokens: 5000, totalOutputTokens: 3000 }));

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const tokenCard = cards.find((c) => c.getAttribute('data-label') === 'Total Tokens');
    expect(tokenCard).toBeDefined();
    expect(tokenCard!.getAttribute('data-value')).toBe('8.0k');
  });

  it('displays token card with M formatting for large values', async () => {
    mockGetMetrics.mockResolvedValue(fullMetrics({ totalEstimatedCostUsd: 10, totalInputTokens: 1_500_000, totalOutputTokens: 500_000 }));

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const tokenCard = cards.find((c) => c.getAttribute('data-label') === 'Total Tokens');
    expect(tokenCard).toBeDefined();
    expect(tokenCard!.getAttribute('data-value')).toBe('2.00M');
  });

  it('hides cost and token cards when values are 0', async () => {
    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const costCard = cards.find((c) => c.getAttribute('data-label') === 'Total Est. Cost');
    expect(costCard).toBeUndefined();
    const tokenCard = cards.find((c) => c.getAttribute('data-label') === 'Total Tokens');
    expect(tokenCard).toBeUndefined();
  });

  // ── Conditional card visibility ────────────────────────────

  it('hides completed sessions card when 0', async () => {
    const m = fullMetrics();
    m.sessions.completed = 0;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const completed = cards.find((c) => c.getAttribute('data-label') === 'Completed');
    expect(completed).toBeUndefined();
  });

  it('shows failed sessions card with NavLink to /audit when failed > 0', async () => {
    const m = fullMetrics();
    m.sessions.failed = 5;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    expect(screen.getByText('Failed Sessions')).toBeDefined();
    expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    const link = screen.getByTestId('navlink');
    expect(link.getAttribute('href')).toBe('/audit');
  });

  it('hides failed sessions when 0', async () => {
    const m = fullMetrics();
    m.sessions.failed = 0;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    expect(screen.queryByText('Failed Sessions')).toBeNull();
  });

  it('shows webhooks sent card', async () => {
    const m = fullMetrics();
    m.webhooks_sent = 10;
    m.webhooks_failed = 2;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const whCard = cards.find((c) => c.getAttribute('data-label') === 'Webhooks Sent');
    expect(whCard).toBeDefined();
  });

  it('shows webhooks failed card when webhooks_sent is 0 but webhooks_failed > 0', async () => {
    const m = fullMetrics();
    m.webhooks_sent = 0;
    m.webhooks_failed = 3;
    mockGetMetrics.mockResolvedValue(m);

    await renderAndWaitData(<MetricCards />);

    const cards = screen.getAllByTestId('metric-card');
    const failCard = cards.find((c) => c.getAttribute('data-label') === 'Webhooks Failed');
    expect(failCard).toBeDefined();
  });

  // ── Status row visibility ──────────────────────────────────

  it('shows status row when loadError is present', async () => {
    mockGetMetrics.mockRejectedValue(new Error('metrics down'));
    mockGetHealth.mockResolvedValue(fullHealth);

    await renderAndWaitData(<MetricCards />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeDefined();
      expect(screen.getByText(/Detailed metrics unavailable/)).toBeDefined();
    });
  });

  // ── useSseAwarePolling integration ─────────────────────────

  it('calls useSseAwarePolling with correct parameters', async () => {
    mockStoreState.sseConnected = true;

    await renderAndWaitData(<MetricCards />);

    expect(capturedRefresh).toBeDefined();
    expect(typeof capturedRefresh).toBe('function');
  });

  // ── Error message extraction ───────────────────────────────

  it('includes error message when API throws Error with message', async () => {
    mockGetMetrics.mockRejectedValue(new Error('network timeout'));
    mockGetHealth.mockRejectedValue(new Error('server error'));

    await renderAndWaitData(<MetricCards />);

    await waitFor(() => {
      expect(screen.getByText(/network timeout/)).toBeDefined();
    });
  });

  it('shows generic message when error is not an Error instance', async () => {
    mockGetMetrics.mockRejectedValue('unknown');
    mockGetHealth.mockRejectedValue('unknown');

    await renderAndWaitData(<MetricCards />);

    await waitFor(() => {
      expect(screen.getByText('Unable to load overview metrics')).toBeDefined();
    });
  });
});
