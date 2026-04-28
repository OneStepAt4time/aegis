/**
 * __tests__/components/analytics/TimeFilterBar.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimeFilterBar, { type TimeRange } from '../components/analytics/TimeFilterBar';

describe('TimeFilterBar', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock URL API
    delete (window as unknown as Record<string, unknown>).location;
    (window as any).location = {
      pathname: '/analytics',
      search: '',
      href: '/analytics',
      replaceState: vi.fn(),
    } as unknown as Location;
  });

  function renderBar(value: TimeRange = { from: null, to: null }) {
    return render(<TimeFilterBar value={value} onChange={onChange} />);
  }

  it('renders all 6 preset buttons', () => {
    renderBar();
    expect(screen.getByRole('toolbar', { name: 'Time range filter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1h' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '12h' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Last week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Last month' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
  });

  it('calls onChange with null range when "All" is clicked', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith({ from: null, to: null });
  });

  it('calls onChange with ISO date range when "1h" is clicked', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: '1h' }));
    const call = onChange.mock.calls[0][0] as TimeRange;
    expect(call.from).toBeTruthy();
    expect(call.to).toBeTruthy();
    const fromTime = new Date(call.from!).getTime();
    const toTime = new Date(call.to!).getTime();
    const diffMinutes = (toTime - fromTime) / (1000 * 60);
    expect(diffMinutes).toBeGreaterThanOrEqual(55);
    expect(diffMinutes).toBeLessThanOrEqual(65);
  });

  it('sets aria-pressed on active button', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('updates aria-pressed when a different preset is clicked', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('syncs from URL params on mount', () => {
    window.location.search = '?from=2026-04-01T00:00:00.000Z&to=2026-04-28T00:00:00.000Z';
    renderBar();
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-28T00:00:00.000Z',
    });
  });

  it('sets from and to in onChange when a preset is clicked', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Last week' }));
    const call = onChange.mock.calls[0][0] as TimeRange;
    expect(call.from).toBeTruthy();
    expect(call.to).toBeTruthy();
  });

  it('accepts className prop', () => {
    const { container } = render(
      <TimeFilterBar value={{ from: null, to: null }} onChange={onChange} className="extra-class" />,
    );
    expect(container.firstChild).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toContain('extra-class');
  });

  it('computes "Today" preset starting at midnight', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    const call = onChange.mock.calls[0][0] as TimeRange;
    const fromDate = new Date(call.from!);
    expect(fromDate.getHours()).toBe(0);
    expect(fromDate.getMinutes()).toBe(0);
  });

  it('computes "Last month" preset approximately 30 days back', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    const call = onChange.mock.calls[0][0] as TimeRange;
    const fromTime = new Date(call.from!).getTime();
    const toTime = new Date(call.to!).getTime();
    const diffDays = (toTime - fromTime) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(28);
    expect(diffDays).toBeLessThanOrEqual(32);
  });
});
