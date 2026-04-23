/**
 * __tests__/MetricsPage.test.tsx — Issue #2087
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MetricsPage from '../pages/MetricsPage';
import { useAuthStore } from '../store/useAuthStore';

const mockMetrics = {
  uptime: 3600,
  sessions: {
    total_created: 142,
    currently_active: 3,
    completed: 130,
    failed: 12,
    avg_duration_sec: 384,
    avg_messages_per_session: 24,
  },
  auto_approvals: 312,
  webhooks_sent: 89,
  webhooks_failed: 2,
  screenshots_taken: 45,
  pipelines_created: 7,
  batches_created: 3,
  prompt_delivery: {
    sent: 1000,
    delivered: 980,
    failed: 20,
    success_rate: 0.98,
  },
  latency: {
    hook_latency_ms: { p50: 120, p95: 450, p99: 800 },
    state_change_detection_ms: { p50: 5, p95: 20, p99: 50 },
    permission_response_ms: { p50: 30, p95: 120, p99: 200 },
    channel_delivery_ms: { p50: 80, p95: 300, p99: 600 },
  },
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter future={{ v7_startTransition: true }}>{ui}</MemoryRouter>);
}

describe('MetricsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    useAuthStore.setState({ token: 'test-token' });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading skeletons initially', () => {
    renderWithRouter(<MetricsPage />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders summary stat cards when data loads', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetrics),
    } as Response);

    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeTruthy();
    });
    expect(screen.getByText('142')).toBeTruthy();
    expect(screen.getByText('Completion')).toBeTruthy();
    expect(screen.getByText('Prompt Rate')).toBeTruthy();
  });

  it('shows correct completion rate', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetrics),
    } as Response);

    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('92%')).toBeTruthy(); // 130/142 ≈ 92%
    });
  });

  it('shows average duration in minutes', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetrics),
    } as Response);

    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('6.4')).toBeTruthy(); // 384/60 = 6.4 min
    });
  });

  it('shows error state with retry button', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load metrics/)).toBeTruthy();
    });
    const btn = screen.getByRole('button', { name: /Retry/i });
    expect(btn).toBeTruthy();
  });

  it('shows coming soon notice for time-series features', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetrics),
    } as Response);

    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Sessions Over Time/)).toBeTruthy();
    });
  });

  it('renders all secondary stat cards', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockMetrics),
    } as Response);

    renderWithRouter(<MetricsPage />);
    await waitFor(() => {
      expect(screen.getByText('312')).toBeTruthy(); // auto_approvals
      expect(screen.getByText('89')).toBeTruthy(); // webhooks_sent
      expect(screen.getByText('2 failed')).toBeTruthy(); // webhooks_failed
      expect(screen.getByText('45')).toBeTruthy(); // screenshots
      expect(screen.getByText('7')).toBeTruthy(); // pipelines
      expect(screen.getByText('3')).toBeTruthy(); // batches
      expect(screen.getByText('20')).toBeTruthy(); // prompts failed
    });
  });
});
