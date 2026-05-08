/**
 * RoutinesPage.test.tsx — Tests for the Routines page scaffold.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RoutinesPage from '../pages/RoutinesPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <RoutinesPage />
    </MemoryRouter>
  );
}

describe('RoutinesPage', () => {
  it('renders page heading', () => {
    renderPage();
    expect(screen.getByText('Routines')).not.toBeNull();
  });

  it('renders empty state when no routines', () => {
    renderPage();
    expect(screen.getByText('No routines yet')).not.toBeNull();
  });

  it('renders New Routine button', () => {
    renderPage();
    expect(screen.getByLabelText('Create new routine')).not.toBeNull();
  });

  it('renders calendar grid', () => {
    renderPage();
    expect(screen.getByRole('grid', { name: 'Calendar' })).not.toBeNull();
  });

  it('renders weekday headers in calendar', () => {
    renderPage();
    expect(screen.getByText('Mon')).not.toBeNull();
    expect(screen.getByText('Sun')).not.toBeNull();
  });

  it('renders sidebar with Upcoming label', () => {
    renderPage();
    expect(screen.getByText('Upcoming')).not.toBeNull();
  });
});
