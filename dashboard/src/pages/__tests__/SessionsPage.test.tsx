/**
 * SessionsPage tab routing tests — #3991.
 *
 * Verifies tab switching renders the correct panel content.
 * SessionBoard and SessionHistoryPage are lazy-loaded via React.lazy,
 * so all board/all assertions must use waitFor for Suspense resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../components/overview/SessionBoard', () => ({
  __esModule: true,
  SessionBoard: () => <div data-testid="session-board">Board View</div>,
}));

vi.mock('../../components/overview/SessionTable', () => ({
  __esModule: true,
  default: () => <div data-testid="session-table">Active Table</div>,
}));

vi.mock('../SessionHistoryPage', () => ({
  __esModule: true,
  default: () => <div data-testid="session-history">History Page</div>,
}));

vi.mock('../../components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../components/shared/Skeleton', () => ({
  SkeletonTable: () => <div data-testid="skeleton">Loading skeleton</div>,
}));

vi.mock('../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

import SessionsPage from '../SessionsPage';

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

  it('renders Board tab panel when ?tab=board', async () => {
    renderWithRouter('/sessions?tab=board');

    // SessionBoard is lazy-loaded via React.lazy — needs waitFor
    await waitFor(() => {
      expect(screen.getByTestId('session-board')).not.toBeNull();
    });
    const boardTab = screen.getByRole('tab', { name: 'Board' });
    expect(boardTab.getAttribute('aria-selected')).toBe('true');
  });

  it('renders All tab panel when ?tab=all', async () => {
    renderWithRouter('/sessions?tab=all');

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

    // Board is lazy — wait for Suspense to resolve
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
