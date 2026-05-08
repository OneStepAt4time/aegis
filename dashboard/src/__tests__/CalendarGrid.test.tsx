/**
 * CalendarGrid.test.tsx — Tests for the monthly calendar grid component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CalendarGrid from '../components/routines/CalendarGrid';
import type { RoutineSchedule } from '../components/routines/CalendarGrid';

const mockRoutines: RoutineSchedule[] = [
  {
    id: 'r1',
    title: 'Daily build',
    cronSchedule: '0 9 * * *',
    nextRunAt: '2026-05-10T09:00:00Z',
    status: 'active',
  },
  {
    id: 'r2',
    title: 'Weekly report',
    cronSchedule: '0 10 * * 1',
    nextRunAt: '2026-05-12T10:00:00Z',
    status: 'paused',
  },
];

describe('CalendarGrid', () => {
  it('renders weekday headers', () => {
    render(
      <CalendarGrid routines={[]} selectedDate={null} onSelectDate={() => {}} />
    );
    expect(screen.getByText('Mon')).not.toBeNull();
    expect(screen.getByText('Sun')).not.toBeNull();
  });

  it('renders calendar grid with aria-label', () => {
    render(
      <CalendarGrid routines={[]} selectedDate={null} onSelectDate={() => {}} />
    );
    const grid = screen.getByRole('grid', { name: 'Calendar' });
    expect(grid).not.toBeNull();
  });

  it('navigates to previous month without crashing', () => {
    render(
      <CalendarGrid routines={[]} selectedDate={null} onSelectDate={() => {}} />
    );
    const prevBtn = screen.getByLabelText('Previous month');
    fireEvent.click(prevBtn);
    expect(screen.getByLabelText('Next month')).not.toBeNull();
  });

  it('navigates to next month without crashing', () => {
    render(
      <CalendarGrid routines={[]} selectedDate={null} onSelectDate={() => {}} />
    );
    const nextBtn = screen.getByLabelText('Next month');
    fireEvent.click(nextBtn);
    expect(screen.getByLabelText('Previous month')).not.toBeNull();
  });

  it('goes to today when Today button is clicked', () => {
    render(
      <CalendarGrid routines={[]} selectedDate={null} onSelectDate={() => {}} />
    );
    fireEvent.click(screen.getByLabelText('Next month'));
    fireEvent.click(screen.getByLabelText('Go to today'));
    expect(screen.getByRole('grid', { name: 'Calendar' })).not.toBeNull();
  });

  it('renders with routines data without crashing', () => {
    render(
      <CalendarGrid
        routines={mockRoutines}
        selectedDate={null}
        onSelectDate={() => {}}
      />
    );
    expect(screen.getByRole('grid', { name: 'Calendar' })).not.toBeNull();
  });

  it('renders Today shortcut button', () => {
    render(
      <CalendarGrid routines={[]} selectedDate={null} onSelectDate={() => {}} />
    );
    expect(screen.getByLabelText('Go to today')).not.toBeNull();
  });
});
