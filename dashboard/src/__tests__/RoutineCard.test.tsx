/**
 * __tests__/RoutineCard.test.tsx — Tests for RoutineCard component.
 *
 * Verifies: title display, status badge, action buttons, next run time.
 * @ticket #2908
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RoutineCard from '../components/routines/RoutineCard';
import type { RoutineSchedule } from '../components/routines/CalendarGrid';

const activeRoutine: RoutineSchedule = {
  id: 'routine-1',
  title: 'Daily standup',
  cronSchedule: '0 9 * * MON-FRI',
  nextRunAt: new Date(Date.now() + 3600000).toISOString(), // 1h from now
  status: 'active',
};

const pausedRoutine: RoutineSchedule = {
  id: 'routine-2',
  title: 'Weekly deploy',
  cronSchedule: '0 14 * * FRI',
  nextRunAt: new Date(Date.now() + 86400000).toISOString(), // 1d from now
  status: 'paused',
};

describe('RoutineCard', () => {
  it('renders the routine title', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByText('Daily standup')).toBeTruthy();
  });

  it('shows active status badge for active routine', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('shows paused status badge for paused routine', () => {
    render(<RoutineCard routine={pausedRoutine} />);
    expect(screen.getByText('Paused')).toBeTruthy();
  });

  it('displays the cron schedule', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByText('0 9 * * MON-FRI')).toBeTruthy();
  });

  it('renders pause button for active routine', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByRole('button', { name: /pause routine/i })).toBeTruthy();
  });

  it('renders resume button for paused routine', () => {
    render(<RoutineCard routine={pausedRoutine} />);
    expect(screen.getByRole('button', { name: /resume routine/i })).toBeTruthy();
  });

  it('renders trigger now button', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByRole('button', { name: /trigger routine now/i })).toBeTruthy();
  });

  it('renders delete button', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByRole('button', { name: /delete routine/i })).toBeTruthy();
  });

  it('calls onTogglePause when pause button is clicked', () => {
    const onTogglePause = vi.fn();
    render(<RoutineCard routine={activeRoutine} onTogglePause={onTogglePause} />);
    fireEvent.click(screen.getByRole('button', { name: /pause routine/i }));
    expect(onTogglePause).toHaveBeenCalledWith('routine-1');
  });

  it('calls onTriggerNow when trigger button is clicked', () => {
    const onTriggerNow = vi.fn();
    render(<RoutineCard routine={activeRoutine} onTriggerNow={onTriggerNow} />);
    fireEvent.click(screen.getByRole('button', { name: /trigger routine now/i }));
    expect(onTriggerNow).toHaveBeenCalledWith('routine-1');
  });

  it('calls onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<RoutineCard routine={activeRoutine} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete routine/i }));
    expect(onDelete).toHaveBeenCalledWith('routine-1');
  });

  it('does not show next run time for paused routine', () => {
    render(<RoutineCard routine={pausedRoutine} />);
    // Paused routines don't show the clock/next run
    const clockIcon = screen.queryByTitle('Next run');
    expect(clockIcon).toBeNull();
  });
});
