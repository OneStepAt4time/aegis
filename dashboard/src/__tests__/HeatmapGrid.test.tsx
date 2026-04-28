/**
 * __tests__/HeatmapGrid.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeatmapGrid, type HeatmapDataPoint } from '../components/analytics/HeatmapGrid';

/** Generate daily data for the last N days. */
function generateDailyData(days: number, maxVal: number = 100): HeatmapDataPoint[] {
  const data: HeatmapDataPoint[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0] ?? '';
    data.push({
      date: dateStr,
      value: Math.round(Math.random() * maxVal),
    });
  }
  return data;
}

describe('HeatmapGrid', () => {
  it('renders an SVG with the correct role', () => {
    const data = generateDailyData(30);
    render(<HeatmapGrid data={data} metricLabel="Sessions" />);
    const svg = screen.getByRole('img', { name: /Sessions heatmap/ });
    expect(svg).toBeTruthy();
  });

  it('renders grid cells for every day in the range', () => {
    const data = generateDailyData(7);
    render(<HeatmapGrid data={data} weeks={1} />);
    // 1 week × 7 days = 7 cells
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
    const data: HeatmapDataPoint[] = [
      { date: '2026-04-28', value: 42 },
    ];
    render(<HeatmapGrid data={data} weeks={1} metricLabel="tokens" />);
    const cell = screen.getByRole('gridcell', { name: /2026-04-28: 42 tokens/ });
    expect(cell).toBeTruthy();
  });

  it('uses color intensity based on value relative to max', () => {
    const data: HeatmapDataPoint[] = [
      { date: '2026-04-28', value: 0 },   // level 0
      { date: '2026-04-27', value: 10 },  // level 1 (10/100 = 0.1)
      { date: '2026-04-26', value: 50 },  // level 2 (50/100 = 0.5)
      { date: '2026-04-25', value: 75 },  // level 3 (75/100 = 0.75)
      { date: '2026-04-24', value: 100 }, // level 4 (100/100 = 1.0)
    ];
    const { container } = render(<HeatmapGrid data={data} weeks={1} />);
    const rects = container.querySelectorAll('rect[role="gridcell"]');

    // Verify different fill values — level 0 should differ from level 4
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

    // Both should render the same number of cells
    expect(cyanCells.length).toBe(purpleCells.length);

    // Colors should differ for at least some non-zero cells
    const cyanFills = Array.from(cyanCells).map((r) => r.getAttribute('fill'));
    const purpleFills = Array.from(purpleCells).map((r) => r.getAttribute('fill'));

    // At least one cell with a value should have different fills between cyan and purple
    const hasDifference = cyanFills.some(
      (f, i) => f !== purpleFills[i] && f !== 'var(--color-void-light)',
    );
    expect(hasDifference).toBe(true);
  });

  it('formats tooltip values using formatValue prop', () => {
    const data: HeatmapDataPoint[] = [
      { date: '2026-04-28', value: 1234 },
    ];
    render(
      <HeatmapGrid
        data={data}
        weeks={1}
        metricLabel="tokens"
        formatValue={(v) => `${(v / 1000).toFixed(1)}K`}
      />,
    );
    const cell = screen.getByRole('gridcell', { name: /2026-04-28: 1.2K tokens/ });
    expect(cell).toBeTruthy();
  });

  it('renders legend with Less/More labels', () => {
    const data = generateDailyData(7);
    const { container } = render(<HeatmapGrid data={data} weeks={1} />);
    expect(screen.getByText('Less')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();

    // Legend should have 5 color swatches
    const swatches = container.querySelectorAll('.rounded-sm');
    expect(swatches).toHaveLength(5);
  });

  it('renders month labels for transitions', () => {
    // Generate data spanning 2 months
    const data: HeatmapDataPoint[] = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      data.push({ date: d.toISOString().split('T')[0] ?? '', value: 10 });
    }
    render(<HeatmapGrid data={data} weeks={9} />);
    // Should have at least 1 month label
    const textElements = document.querySelectorAll('svg text');
    const monthTexts = Array.from(textElements).filter(
      (t) => t.textContent && ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].includes(t.textContent),
    );
    expect(monthTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('shows tooltip on cell hover', () => {
    const data: HeatmapDataPoint[] = [
      { date: '2026-04-28', value: 99 },
      { date: '2026-04-27', value: 0 },
    ];
    render(<HeatmapGrid data={data} weeks={1} />);

    const cell = screen.getByRole('gridcell', { name: /2026-04-28/ });
    fireEvent.mouseEnter(cell);

    // Tooltip should appear as SVG text
    const svg = screen.getByRole('img');
    const tooltipGroup = svg.querySelector('g[pointer-events="none"]');
    expect(tooltipGroup).toBeTruthy();
  });

  it('hides tooltip on cell leave', () => {
    const data: HeatmapDataPoint[] = [
      { date: '2026-04-28', value: 50 },
    ];
    render(<HeatmapGrid data={data} weeks={1} />);

    const cell = screen.getByRole('gridcell', { name: /2026-04-28/ });
    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);

    // Tooltip group should be gone
    const svg = screen.getByRole('img');
    const tooltipGroup = svg.querySelector('g[pointer-events="none"]');
    expect(tooltipGroup).toBeNull();
  });

  it('renders empty cells with zero value as level 0', () => {
    const data: HeatmapDataPoint[] = [
      { date: '2026-04-28', value: 0 },
    ];
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
