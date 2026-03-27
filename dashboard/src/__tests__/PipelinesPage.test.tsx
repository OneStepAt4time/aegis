import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PipelinesPage from '../pages/PipelinesPage';
import type { PipelineInfo } from '../api/client';

const mockGetPipelines = vi.fn();

vi.mock('../api/client', () => ({
  getPipelines: (...args: unknown[]) => mockGetPipelines(...args),
}));

function renderPage(): void {
  render(
    <MemoryRouter>
      <PipelinesPage />
    </MemoryRouter>,
  );
}

const mockPipelines: PipelineInfo[] = [
  {
    id: 'pipe-1',
    name: 'Build Pipeline',
    status: 'running',
    sessions: [
      { id: 's1', status: 'completed' } as PipelineInfo['sessions'][0],
      { id: 's2', status: 'working' } as PipelineInfo['sessions'][0],
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'pipe-2',
    name: 'Test Pipeline',
    status: 'completed',
    sessions: [],
    createdAt: new Date().toISOString(),
  },
];

describe('PipelinesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPipelines.mockResolvedValue([]);
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
      expect(screen.getByText('Running')).toBeDefined();
    });
  });

  it('shows step count for each pipeline', async () => {
    mockGetPipelines.mockResolvedValue(mockPipelines);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/2 steps/)).toBeDefined();
    });
  });
});
