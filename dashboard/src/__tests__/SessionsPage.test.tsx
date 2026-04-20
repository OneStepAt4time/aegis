/**
 * SessionsPage.test.tsx — Tests for the combined Sessions page with Active/All tabs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// Mock SessionTable (Active tab content)
vi.mock('../components/overview/SessionTable', () => ({
  default: () => <div data-testid="session-table">Active Sessions Table</div>,
}));

// Mock SessionHistoryPage (All tab content)
vi.mock('../pages/SessionHistoryPage', () => ({
  default: () => <div data-testid="session-history-page">Session History Page</div>,
}));

import SessionsPage from '../pages/SessionsPage';

function renderPage(initialPath = '/sessions') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/sessions" element={<SessionsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeDefined();
  });

  it('renders two tabs: Active and All', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Active' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'All' })).toBeDefined();
  });

  it('defaults to Active tab', () => {
    renderPage();
    const activeTab = screen.getByRole('tab', { name: 'Active' });
    expect(activeTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('session-table')).toBeDefined();
    expect(screen.queryByTestId('session-history-page')).toBeNull();
  });

  it('reads tab from URL query param ?tab=all', async () => {
    renderPage('/sessions?tab=all');
    const allTab = screen.getByRole('tab', { name: 'All' });
    expect(allTab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByTestId('session-history-page')).toBeDefined();
    expect(screen.queryByTestId('session-table')).toBeNull();
  });

  it('switches to All tab on click and updates URL state', async () => {
    renderPage();
    // Initially on Active tab
    expect(screen.getByTestId('session-table')).toBeDefined();

    // Click All tab
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));

    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByTestId('session-history-page')).toBeDefined();
  });

  it('switches back to Active tab from All tab', async () => {
    renderPage('/sessions?tab=all');
    // Initially on All tab
    expect(await screen.findByTestId('session-history-page')).toBeDefined();

    // Click Active tab
    fireEvent.click(screen.getByRole('tab', { name: 'Active' }));

    expect(screen.getByRole('tab', { name: 'Active' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('session-table')).toBeDefined();
  });

  it('renders tab panels with correct roles', () => {
    renderPage();
    const panels = screen.getAllByRole('tabpanel');
    expect(panels).toHaveLength(1);
    expect(panels[0].getAttribute('aria-label')).toBe('Active sessions');
  });
});
