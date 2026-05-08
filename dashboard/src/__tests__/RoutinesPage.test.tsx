/**
 * __tests__/RoutinesPage.test.tsx — Tests for the RoutinesPage scaffold.
 *
 * Verifies: empty state rendering, navigation elements, calendar presence.
 * @ticket #2908
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RoutinesPage from '../pages/RoutinesPage';

// Mock useAuthStore so ProtectedRoute doesn't redirect
vi.mock('../store/useAuthStore', () => ({
  useAuthStore: vi.fn(() => ({ isAuthenticated: true })),
}));

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('RoutinesPage', () => {
  it('renders the page title', () => {
    renderWithRouter(<RoutinesPage />);
    expect(screen.getByText('Routines')).toBeTruthy();
  });

  it('renders the subtitle description', () => {
    renderWithRouter(<RoutinesPage />);
    expect(screen.getByText('Scheduled tasks that run on a recurring basis')).toBeTruthy();
  });

  it('shows the New Routine button', () => {
    renderWithRouter(<RoutinesPage />);
    expect(screen.getByRole('button', { name: /create new routine/i })).toBeTruthy();
  });

  it('shows empty state when no routines exist', () => {
    renderWithRouter(<RoutinesPage />);
    expect(screen.getByText('No routines yet')).toBeTruthy();
  });

  it('renders the calendar grid', () => {
    renderWithRouter(<RoutinesPage />);
    // Calendar grid has role="grid" with aria-label="Calendar"
    expect(screen.getByRole('grid', { name: 'Calendar' })).toBeTruthy();
  });

  it('renders weekday headers', () => {
    renderWithRouter(<RoutinesPage />);
    expect(screen.getByText('Mon')).toBeTruthy();
    expect(screen.getByText('Sun')).toBeTruthy();
  });

  it('renders Today button in calendar header', () => {
    renderWithRouter(<RoutinesPage />);
    expect(screen.getByRole('button', { name: /go to today/i })).toBeTruthy();
  });

  it('renders month navigation buttons', () => {
    renderWithRouter(<RoutinesPage />);
    expect(screen.getByRole('button', { name: /previous month/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /next month/i })).toBeTruthy();
  });
});
