/**
 * __tests__/CalendarGrid.test.tsx — Tests for CalendarGrid component.
 *
 * Verifies: month display, day rendering, routine highlighting, navigation.
 * @ticket #2908
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarGrid } from '../components/routines';
import type { RoutineSchedule } from '../components/routines/CalendarGrid';

const mockRoutines: RoutineSchedule[] = [
  {
    id: 'routine-1',
    title: 'Daily standup',
    cronSchedule: '0 9 * * MON-FRI',
    nextRunAt: new Date().toISOString(),
    status: 'active',
  },
  {
    id: 'routine-2',
    title: 'Weekly deploy',
    cronSchedule: '0 14 * * FRI',
    nextRunAt: new Date().toISOString(),
    status: 'paused',
  },
];

describe('CalendarGrid', () => {
  const defaultProps = {
    routines: [] as RoutineSchedule[],
    selectedDate: null as Date | null,
    onSelectDate: vi.fn(),
  };

  it('renders the current month and year', () => {
    render(<CalendarGrid {...defaultProps} />);
    const now = new Date();
    const expected = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('renders weekday headers', () => {
    render(<CalendarGrid {...defaultProps} />);
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach((day) => {
      expect(screen.getByText(day)).toBeTruthy();
    });
  });

  it('renders navigation buttons', () => {
    render(<CalendarGrid {...defaultProps} />);
    expect(screen.getByRole('button', { name: /previous month/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /next month/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /go to today/i })).toBeTruthy();
  });

  it('calls onSelectDate when a day is clicked', () => {
    const onSelectDate = vi.fn();
    render(<CalendarGrid {...defaultProps} onSelectDate={onSelectDate} />);
    // Click on any day button in current month
    const dayButtons = screen.getAllByRole('button').filter(
      (btn) => {
        const el = btn as HTMLButtonElement;
        return el.textContent != null && /^\d+$/.test(el.textContent.trim()) && !el.disabled;
      }
    ) as HTMLButtonElement[];
    if (dayButtons.length > 0) {
      fireEvent.click(dayButtons[0]);
      expect(onSelectDate).toHaveBeenCalledTimes(1);
    }
  });

  it('highlights days with routines', () => {
    render(<CalendarGrid {...defaultProps} routines={mockRoutines} />);
    // Both routines have nextRunAt = today, so today should show routine labels
    expect(screen.getByText('Daily standup')).toBeTruthy();
    expect(screen.getByText('Weekly deploy')).toBeTruthy();
  });

  it('shows routine count overflow indicator', () => {
    const manyRoutines: RoutineSchedule[] = Array.from({ length: 4 }, (_, i) => ({
      id: `r-${i}`,
      title: `Routine ${i}`,
      cronSchedule: '0 9 * * *',
      nextRunAt: new Date().toISOString(),
      status: 'active' as const,
    }));
    render(<CalendarGrid {...defaultProps} routines={manyRoutines} />);
    expect(screen.getByText('+2 more')).toBeTruthy();
  });

  it('advances to next month when next button is clicked', () => {
    render(<CalendarGrid {...defaultProps} />);
    const nextBtn = screen.getByRole('button', { name: /next month/i });
    fireEvent.click(nextBtn);
    // The month header should have changed
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const expected = nextMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('returns to current month when Today is clicked', () => {
    render(<CalendarGrid {...defaultProps} />);
    // Go forward first
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    // Then click Today
    fireEvent.click(screen.getByRole('button', { name: /go to today/i }));
    const now = new Date();
    const expected = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('marks today with aria-current="date"', () => {
    const { container } = render(<CalendarGrid {...defaultProps} />);
    const todayEl = container.querySelector('[aria-current="date"]');
    expect(todayEl).toBeTruthy();
  });
});
