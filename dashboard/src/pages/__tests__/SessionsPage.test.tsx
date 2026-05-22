/**
 * SessionsPage tab routing tests — #3991.
 *
 * Verifies tab switching renders the correct panel content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionsPage from '../SessionsPage';

// Mock SessionBoard
vi.mock('../../components/overview/SessionBoard', () => ({
  SessionBoard: () => <div data-testid="session-board">Board View</div>,
}));

// Mock SessionTable
vi.mock('../../components/overview/SessionTable', () => ({
  __esModule: true,
  default: () => <div data-testid="session-table">Active Table</div>,
}));

// Mock SessionHistoryPage (lazy loaded)
vi.mock('../SessionHistoryPage', () => ({
  __esModule: true,
  default: () => <div data-testid="session-history">History Page</div>,
}));

// Mock ErrorBoundary
vi.mock('../../components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Skeleton
vi.mock('../../components/shared/Skeleton', () => ({
  SkeletonTable: () => <div>Loading skeleton</div>,
}));

// Mock i18n
vi.mock('../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

function renderWithRouter(initialPath: string = '/sessions') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/sessions" element={<SessionsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SessionsPage tab routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to Active tab when no tab param', () => {
    renderWithRouter('/sessions');

    expect(screen.getByTestId('session-table')).not.toBeNull();
    const activeTab = screen.getByRole('tab', { name: 'Active' });
    expect(activeTab.getAttribute('aria-selected')).toBe('true');
  });

  it('renders Board tab panel when ?tab=board', () => {
    renderWithRouter('/sessions?tab=board');

    expect(screen.getByTestId('session-board')).not.toBeNull();
    const boardTab = screen.getByRole('tab', { name: 'Board' });
    expect(boardTab.getAttribute('aria-selected')).toBe('true');
  });

  it('renders All tab panel when ?tab=all', async () => {
    renderWithRouter('/sessions?tab=all');

    // SessionHistoryPage is lazy loaded
    await waitFor(() => {
      expect(screen.getByTestId('session-history')).not.toBeNull();
    });
    const allTab = screen.getByRole('tab', { name: 'All' });
    expect(allTab.getAttribute('aria-selected')).toBe('true');
  });

  it('switches to Board tab on click', async () => {
    renderWithRouter('/sessions');

    // Starts on Active tab
    expect(screen.getByTestId('session-table')).not.toBeNull();

    // Click Board tab
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));

    // Board panel should appear
    await waitFor(() => {
      expect(screen.getByTestId('session-board')).not.toBeNull();
    });
  });

  it('switches to All tab on click', async () => {
    renderWithRouter('/sessions');

    fireEvent.click(screen.getByRole('tab', { name: 'All' }));

    await waitFor(() => {
      expect(screen.getByTestId('session-history')).not.toBeNull();
    });
  });

  it('falls back to Active tab for unknown tab param', () => {
    renderWithRouter('/sessions?tab=nonexistent');

    expect(screen.getByTestId('session-table')).not.toBeNull();
    const activeTab = screen.getByRole('tab', { name: 'Active' });
    expect(activeTab.getAttribute('aria-selected')).toBe('true');
  });

  it('renders all three tabs in the tablist', () => {
    renderWithRouter('/sessions');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map(t => t.textContent)).toEqual(['Active', 'Board', 'All']);
  });
});
