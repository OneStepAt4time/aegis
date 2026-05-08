/**
 * RoutineCard.test.tsx — Tests for the routine display card component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RoutineCard from '../components/routines/RoutineCard';
import type { RoutineSchedule } from '../components/routines/CalendarGrid';

const activeRoutine: RoutineSchedule = {
  id: 'r1',
  title: 'Daily build',
  cronSchedule: '0 9 * * *',
  nextRunAt: new Date(Date.now() + 3600000).toISOString(),
  status: 'active',
};

const pausedRoutine: RoutineSchedule = {
  id: 'r2',
  title: 'Weekly report',
  cronSchedule: '0 10 * * 1',
  nextRunAt: new Date(Date.now() + 86400000).toISOString(),
  status: 'paused',
};

describe('RoutineCard', () => {
  it('renders routine title', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByText('Daily build')).not.toBeNull();
  });

  it('renders cron schedule', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByText('0 9 * * *')).not.toBeNull();
  });

  it('shows Active status for active routine', () => {
    render(<RoutineCard routine={activeRoutine} />);
    expect(screen.getByText('Active')).not.toBeNull();
  });

  it('shows Paused status for paused routine', () => {
    render(<RoutineCard routine={pausedRoutine} />);
    expect(screen.getByText('Paused')).not.toBeNull();
  });

  it('calls onTogglePause when pause button clicked', () => {
    const handleToggle = vi.fn();
    render(<RoutineCard routine={activeRoutine} onTogglePause={handleToggle} />);
    fireEvent.click(screen.getByLabelText('Pause routine'));
    expect(handleToggle).toHaveBeenCalledWith('r1');
  });

  it('calls onTogglePause (resume) for paused routine', () => {
    const handleToggle = vi.fn();
    render(<RoutineCard routine={pausedRoutine} onTogglePause={handleToggle} />);
    fireEvent.click(screen.getByLabelText('Resume routine'));
    expect(handleToggle).toHaveBeenCalledWith('r2');
  });

  it('calls onTriggerNow when trigger button clicked', () => {
    const handleTrigger = vi.fn();
    render(<RoutineCard routine={activeRoutine} onTriggerNow={handleTrigger} />);
    fireEvent.click(screen.getByLabelText('Trigger routine now'));
    expect(handleTrigger).toHaveBeenCalledWith('r1');
  });

  it('calls onDelete when delete button clicked', () => {
    const handleDelete = vi.fn();
    render(<RoutineCard routine={activeRoutine} onDelete={handleDelete} />);
    fireEvent.click(screen.getByLabelText('Delete routine'));
    expect(handleDelete).toHaveBeenCalledWith('r1');
  });

  it('has routine article role with aria-label', () => {
    render(<RoutineCard routine={activeRoutine} />);
    const article = screen.getByRole('article');
    expect(article).not.toBeNull();
    expect(article.getAttribute('aria-label')).toContain('Daily build');
  });
});
