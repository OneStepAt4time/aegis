import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  sessions: [
    {
      id: 's1',
      windowId: 'w1',
      windowName: 'step-1',
      workDir: '/home/user/project-a',
      status: 'idle',
      createdAt: Date.now() - 3600000,
      lastActivity: Date.now() - 600000,
      byteOffset: 0,
      monitorOffset: 0,
      stallThresholdMs: 300000,
      permissionMode: 'default',
    },
    {
      id: 's2',
      windowId: 'w2',
      windowName: 'step-2',
      workDir: '/home/user/project-b',
      status: 'working',
      createdAt: Date.now() - 1800000,
      lastActivity: Date.now(),
      byteOffset: 0,
      monitorOffset: 0,
      stallThresholdMs: 300000,
      permissionMode: 'default',
    },
  ],
  createdAt: new Date().toISOString(),
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

  it('renders session steps in table', async () => {
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

  it('renders workDir for each session step', async () => {
    mockGetPipeline.mockResolvedValue(mockPipeline);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('/home/user/project-a')).toBeDefined();
      expect(screen.getByText('/home/user/project-b')).toBeDefined();
    });
  });

  it('shows empty steps message when pipeline has no sessions', async () => {
    mockGetPipeline.mockResolvedValue({ ...mockPipeline, sessions: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No steps yet')).toBeDefined();
    });
  });
});
