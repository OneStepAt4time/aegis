import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PipelinesPage from '../pages/PipelinesPage';
import type { PipelineInfo } from '../api/client';
import { useStore } from '../store/useStore';
import { I18nProvider } from '../i18n/context';

const mockGetPipelines = vi.fn();

vi.mock('../api/client', () => ({
  getPipelines: (...args: unknown[]) => mockGetPipelines(...args),
}));

function renderPage(): void {
  render(
    <MemoryRouter>
      <I18nProvider>
        <PipelinesPage />
    </I18nProvider>
    </MemoryRouter>,
  );
}

const mockPipelines: PipelineInfo[] = [
  {
    id: 'pipe-1',
    name: 'Build Pipeline',
    status: 'running',
    stages: [
      { name: 'step-1', status: 'idle', sessionId: 's1' },
      { name: 'step-2', status: 'working', sessionId: 's2' },
    ],
    createdAt: Date.now(),
  },
  {
    id: 'pipe-2',
    name: 'Test Pipeline',
    status: 'completed',
    stages: [],
    createdAt: Date.now(),
  },
];

describe('PipelinesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPipelines.mockResolvedValue([]);
    useStore.setState({ sseConnected: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the Pipelines heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Pipelines')).toBeDefined();
    });
  });

  it('shows empty state when no pipelines exist', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No pipelines yet')).toBeDefined();
    });
  });

  it('shows load error state when pipeline fetch fails', async () => {
    mockGetPipelines.mockRejectedValue(new Error('Rate limit reached. Retrying automatically.'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Unable to load pipelines')).toBeDefined();
      expect(screen.getByText('Rate limit reached. Retrying automatically.')).toBeDefined();
    });
  });

  it('renders pipeline list after fetch', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Build Pipeline')).toBeDefined();
      expect(screen.getByText('Test Pipeline')).toBeDefined();
    });
  });

  it('shows pipeline status badges', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('running')).toBeDefined();
      expect(screen.getByText('completed')).toBeDefined();
    });
  });

  it('opens create modal when New Pipeline button is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Pipelines')).toBeDefined();
    });
    fireEvent.click(screen.getByText('New Pipeline'));
    expect(screen.getByText('New Pipeline', { selector: 'h2' })).toBeDefined();
  });

  it('shows metric cards with pipeline counts', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Total')).toBeDefined();
      // Scope to the metrics grid to avoid matching status filter select options
      const metricsGrid = screen.getByText('Total').closest('.grid');
      expect(metricsGrid?.textContent).toContain('Running');
    });
  });

  it('shows step count for each pipeline', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/2 steps/)).toBeDefined();
    });
  });

  it('uses exponential backoff on fetch failures and resets on success', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    mockGetPipelines
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce(mockPipelines)
      .mockResolvedValue(mockPipelines);

    renderPage();

    await act(async () => {
      await vi.runAllTicks();
    });
    expect(mockGetPipelines).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 20_000)).toBe(true);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mockGetPipelines).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 40_000)).toBe(true);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mockGetPipelines).toHaveBeenCalledTimes(3);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 10_000)).toBe(true);
  });

  it('backs off polling cadence when SSE is healthy', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    useStore.setState({ sseConnected: true });
    mockGetPipelines.mockResolvedValue(mockPipelines);

    renderPage();

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(mockGetPipelines).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it('switches to faster fallback polling when SSE disconnects', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    useStore.setState({ sseConnected: true });
    mockGetPipelines.mockResolvedValue(mockPipelines);

    renderPage();

    await act(async () => {
      await vi.runAllTicks();
    });

    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 30_000)).toBe(true);

    await act(async () => {
      useStore.setState({ sseConnected: false });
      await vi.runAllTicks();
    });

    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 10_000)).toBe(true);
  });
});
