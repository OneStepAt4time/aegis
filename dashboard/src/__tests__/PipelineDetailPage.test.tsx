import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PipelineDetailPage from '../pages/PipelineDetailPage';
import type { PipelineInfo } from '../api/client';

const mockGetPipeline = vi.fn();

vi.mock('../api/client', () => ({
  getPipeline: (...args: unknown[]) => mockGetPipeline(...args),
}));

vi.mock('../components/overview/StatusDot', () => ({
  default: ({ status }: { status: string }) => (
    <span data-testid={`status-dot-${status}`}>{status}</span>
  ),
}));

const mockPipeline: PipelineInfo = {
  id: 'pipe-1',
  name: 'Build Pipeline',
  status: 'running',
  stages: [
    {
      name: 'step-1',
      status: 'idle',
      sessionId: 's1',
      dependsOn: [],
    },
    {
      name: 'step-2',
      status: 'working',
      sessionId: 's2',
      dependsOn: ['step-1'],
    },
  ],
  createdAt: Date.now(),
};

function renderPage(id = 'pipe-1'): void {
  render(
    <MemoryRouter initialEntries={[`/pipelines/${id}`]}>
      <Routes>
        <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PipelineDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders pipeline name and status', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      // Pipeline name appears in breadcrumb and header
      const names = screen.getAllByText('Build Pipeline');
      expect(names.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('running')).toBeDefined();
    });
  });

  it('renders stage steps in table', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('step-1')).toBeDefined();
      expect(screen.getByText('step-2')).toBeDefined();
    });
  });

  it('renders step order numbers', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('#1')).toBeDefined();
      expect(screen.getByText('#2')).toBeDefined();
    });
  });

  it('shows 404 state when pipeline not found', async () => {
    const err = new Error('Not found') as Error & { statusCode: number };
    err.statusCode = 404;
    mockGetPipeline.mockRejectedValue(err);
    renderPage('nonexistent');
    await waitFor(() => {
      expect(screen.getByText('Pipeline not found')).toBeDefined();
    });
  });

  it('renders breadcrumb back to Pipelines', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      const backLink = screen.getByText('Pipelines');
      expect(backLink).toBeDefined();
      expect(backLink.closest('a')?.getAttribute('href')).toBe('/pipelines');
    });
  });

  it('renders session ID for each stage', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('s1')).toBeDefined();
      expect(screen.getByText('s2')).toBeDefined();
    });
  });

  it('shows empty steps message when pipeline has no sessions', async () => {
    mockGetPipeline.mockResolvedValue({ ...mockPipeline, stages: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No steps yet')).toBeDefined();
    });
  });

  it('uses exponential backoff on fetch failures and resets on success', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    mockGetPipeline
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(mockPipeline)
      .mockResolvedValue(mockPipeline);

    renderPage();

    await act(async () => {
      await vi.runAllTicks();
    });
    expect(mockGetPipeline).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 6_000)).toBe(true);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mockGetPipeline).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 12_000)).toBe(true);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(mockGetPipeline).toHaveBeenCalledTimes(3);
    expect(setTimeoutSpy.mock.calls.some((call) => call[1] === 3_000)).toBe(true);
  });
});
