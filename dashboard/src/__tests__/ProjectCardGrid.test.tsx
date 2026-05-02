/**
 * __tests__/ProjectCardGrid.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectCardGrid, type ProjectSummary } from '../components/analytics/ProjectCardGrid';

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const SAMPLE_PROJECTS: ProjectSummary[] = [
  {
    name: 'aegis',
    workDir: '/home/user/projects/aegis',
    sessions: 42,
    totalCostUsd: 15.5,
    totalTokens: 1_200_000,
    costTrend: [1, 2, 3, 4, 5, 4, 3],
  },
  {
    name: 'my-app',
    workDir: '/home/user/projects/my-app',
    sessions: 12,
    totalCostUsd: 3.2,
    totalTokens: 350_000,
    costTrend: [0.5, 1, 0.8, 0.9, 1.2, 1.1, 0.7],
  },
  {
    name: 'empty-project',
    workDir: '/home/user/projects/empty',
    sessions: 0,
    totalCostUsd: 0,
    totalTokens: 0,
    costTrend: [],
  },
];

function renderGrid(projects: ProjectSummary[] = SAMPLE_PROJECTS) {
  return render(
    <MemoryRouter>
      <ProjectCardGrid projects={projects} />
    </MemoryRouter>,
  );
}

describe('ProjectCardGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a card for each project', () => {
    renderGrid();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(3);
  });

  it('renders the grid container with aria-label', () => {
    renderGrid();
    expect(screen.getByRole('list', { name: 'Project cards' })).toBeTruthy();
  });

  it('displays project names', () => {
    renderGrid();
    expect(screen.getByText('aegis')).toBeTruthy();
    expect(screen.getByText('my-app')).toBeTruthy();
    expect(screen.getByText('empty-project')).toBeTruthy();
  });

  it('shows session counts', () => {
    renderGrid();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    // '0' appears in the empty-project's sessions pill
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  });

  it('navigates to project detail on click', () => {
    renderGrid();
    fireEvent.click(screen.getByRole('listitem', { name: /aegis/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/analytics/aegis');
  });

  it('encodes project names with special characters', () => {
    const projects: ProjectSummary[] = [
      {
        name: 'my project',
        workDir: '/home/user/my project',
        sessions: 1,
        totalCostUsd: 0,
        totalTokens: 0,
        costTrend: [],
      },
    ];
    render(
      <MemoryRouter>
        <ProjectCardGrid projects={projects} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('listitem'));
    expect(mockNavigate).toHaveBeenCalledWith('/analytics/my%20project');
  });

  it('renders sparkline for projects with cost trend data', () => {
    renderGrid();
    // SparkLine SVG elements with aria-labels
    const sparklines = screen.getAllByRole('img').filter(
      (el) => el.getAttribute('aria-label')?.includes('Cost trend'),
    );
    expect(sparklines).toHaveLength(2); // aegis and my-app have trend data
  });

  it('does not render sparkline for projects without trend data', () => {
    renderGrid();
    const emptyCard = screen.getByRole('listitem', { name: /empty-project/ });
    // empty-project has no costTrend, so no SparkLine SVG inside
    // (FolderKanban icon SVG has aria-hidden, SparkLine has role="img")
    const sparkSvg = emptyCard.querySelector('svg[role="img"]');
    expect(sparkSvg).toBeNull();
  });

  it('shows empty state when no projects provided', () => {
    renderGrid([]);
    expect(screen.getByText('No project data available')).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(
      <MemoryRouter>
        <ProjectCardGrid projects={SAMPLE_PROJECTS} className="custom-class" />
      </MemoryRouter>,
    );
    const grid = container.querySelector('[role="list"]');
    expect(grid?.className).toContain('custom-class');
  });
});
