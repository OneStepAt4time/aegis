/**
 * __tests__/HeatmapGrid.test.tsx
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeatmapGrid, type HeatmapDataPoint } from '../components/analytics/HeatmapGrid';

const FROZEN = new Date('2026-04-28T12:00:00Z');

/** ISO date string for N days before the frozen time (UTC-safe). */
function utcDate(daysAgo: number): string {
  const d = new Date(FROZEN);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split('T')[0]!;
}

/** Generate daily data for the last N days (UTC-safe). */
function generateDailyData(days: number, maxVal: number = 100): HeatmapDataPoint[] {
  return Array.from({ length: days }, (_, i) => ({
    date: utcDate(i),
    value: Math.round(Math.random() * maxVal),
  }));
}

describe('HeatmapGrid', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an SVG with the correct role', () => {
    const data = generateDailyData(30);
    render(<HeatmapGrid data={data} metricLabel="Sessions" />);
    const svg = screen.getByRole('img', { name: /Sessions heatmap/ });
    expect(svg).toBeTruthy();
  });

  it('renders grid cells for every day in the range', () => {
    const data = generateDailyData(7);
    render(<HeatmapGrid data={data} weeks={1} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(7);
  });

  it('renders cells for 53 weeks by default', () => {
    const data = generateDailyData(10);
    render(<HeatmapGrid data={data} />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBe(53 * 7);
  });

  it('applies aria-labels with date and value to cells', () => {
    // utcDate(0) = 2026-04-28 — guaranteed to be in the 1-week grid
    const data: HeatmapDataPoint[] = [{ date: utcDate(0), value: 42 }];
    render(<HeatmapGrid data={data} weeks={1} metricLabel="tokens" />);
    const cell = screen.getByRole('gridcell', { name: new RegExp(`${utcDate(0)}: 42 tokens`) });
    expect(cell).toBeTruthy();
  });

  it('uses color intensity based on value relative to max', () => {
    // Place data points within the 1-week grid (Mon Apr 27 – Sun May 3)
    // Apr 27 = utcDate(1), Apr 28 = utcDate(0), etc. — all fall in the same week
    const data: HeatmapDataPoint[] = [
      { date: utcDate(0), value: 0 },   // level 0
      { date: utcDate(1), value: 10 },  // level 1
      { date: utcDate(2), value: 50 },  // level 2
      { date: utcDate(3), value: 75 },  // level 3
      { date: utcDate(4), value: 100 }, // level 4
    ];
    const { container } = render(<HeatmapGrid data={data} weeks={1} />);
    const rects = container.querySelectorAll('rect[role="gridcell"]');

    const fills = Array.from(rects).map((r) => r.getAttribute('fill'));
    const uniqueFills = new Set(fills);
    expect(uniqueFills.size).toBeGreaterThan(1);
  });

  it('supports different color scales', () => {
    const data = generateDailyData(14);
    const { container: cyanContainer } = render(
      <HeatmapGrid data={data} weeks={2} color="cyan" />,
    );
    const { container: purpleContainer } = render(
      <HeatmapGrid data={data} weeks={2} color="purple" />,
    );

    const cyanCells = cyanContainer.querySelectorAll('rect[role="gridcell"]');
    const purpleCells = purpleContainer.querySelectorAll('rect[role="gridcell"]');

    expect(cyanCells.length).toBe(purpleCells.length);

    const cyanFills = Array.from(cyanCells).map((r) => r.getAttribute('fill'));
    const purpleFills = Array.from(purpleCells).map((r) => r.getAttribute('fill'));

    const hasDifference = cyanFills.some(
      (f, i) => f !== purpleFills[i] && f !== 'var(--color-void-light)',
    );
    expect(hasDifference).toBe(true);
  });

  it('formats tooltip values using formatValue prop', () => {
    const data: HeatmapDataPoint[] = [{ date: utcDate(0), value: 1234 }];
    render(
      <HeatmapGrid
        data={data}
        weeks={1}
        metricLabel="tokens"
        formatValue={(v) => `${(v / 1000).toFixed(1)}K`}
      />,
    );
    const cell = screen.getByRole('gridcell', { name: new RegExp(`${utcDate(0)}: 1.2K tokens`) });
    expect(cell).toBeTruthy();
  });

  it('renders legend with Less/More labels', () => {
    const data = generateDailyData(7);
    const { container } = render(<HeatmapGrid data={data} weeks={1} />);
    expect(screen.getByText('Less')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();

    const swatches = container.querySelectorAll('.rounded-sm');
    expect(swatches).toHaveLength(5);
  });

  it('renders month labels for transitions', () => {
    const data = generateDailyData(60);
    render(<HeatmapGrid data={data} weeks={9} />);
    const textElements = document.querySelectorAll('svg text');
    const monthTexts = Array.from(textElements).filter(
      (t) => t.textContent && ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].includes(t.textContent),
    );
    expect(monthTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows tooltip on cell hover', () => {
    const data: HeatmapDataPoint[] = [
      { date: utcDate(0), value: 99 },
      { date: utcDate(1), value: 0 },
    ];
    render(<HeatmapGrid data={data} weeks={1} />);

    const cell = screen.getByRole('gridcell', { name: new RegExp(utcDate(0)) });
    fireEvent.mouseEnter(cell);

    const svg = screen.getByRole('img');
    const tooltipGroup = svg.querySelector('g[pointer-events="none"]');
    expect(tooltipGroup).toBeTruthy();
  });

  it('hides tooltip on cell leave', () => {
    const data: HeatmapDataPoint[] = [{ date: utcDate(0), value: 50 }];
    render(<HeatmapGrid data={data} weeks={1} />);

    const cell = screen.getByRole('gridcell', { name: new RegExp(utcDate(0)) });
    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);

    const svg = screen.getByRole('img');
    const tooltipGroup = svg.querySelector('g[pointer-events="none"]');
    expect(tooltipGroup).toBeNull();
  });

  it('renders empty cells with zero value as level 0', () => {
    const data: HeatmapDataPoint[] = [{ date: utcDate(0), value: 0 }];
    const { container } = render(<HeatmapGrid data={data} weeks={1} />);
    const cell = container.querySelector('rect[role="gridcell"]');
    expect(cell?.getAttribute('fill')).toBe('var(--color-void-light)');
  });

  it('accepts className prop', () => {
    const data = generateDailyData(7);
    const { container } = render(
      <HeatmapGrid data={data} weeks={1} className="extra-spacing" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('extra-spacing');
  });
});
