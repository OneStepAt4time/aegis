/**
 * ContributionHeatmap — unit tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContributionHeatmap, type HeatmapDay } from './ContributionHeatmap';

const SAMPLE_DATA: HeatmapDay[] = Array.from({ length: 90 }, (_, i) => {
  const d = new Date('2026-01-01');
  d.setDate(d.getDate() + i);
  return {
    date: d.toISOString().slice(0, 10),
    value: i % 7 === 0 ? 0 : Math.floor(Math.random() * 5000),
  };
});

describe('ContributionHeatmap', () => {
  it('renders without crashing', () => {
    const { container } = render(<ContributionHeatmap data={SAMPLE_DATA} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('shows the label when provided', () => {
    render(<ContributionHeatmap data={[]} label="Input Tokens" />);
    expect(screen.getByText('Input Tokens')).toBeTruthy();
  });

  it('has accessible grid cells', () => {
    render(<ContributionHeatmap data={SAMPLE_DATA} />);
    // Should have many gridcells
    const cells = screen.getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('has accessible summary', () => {
    render(<ContributionHeatmap data={SAMPLE_DATA} unit="tokens" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toContain('tokens');
  });

  it('handles empty data gracefully', () => {
    const { container } = render(<ContributionHeatmap data={[]} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('fires onCellClick when a cell is clicked', () => {
    let clickedDay: HeatmapDay | undefined;
    render(
      <ContributionHeatmap
        data={SAMPLE_DATA}
        onCellClick={(day) => { clickedDay = day; }}
      />,
    );
    const cells = screen.getAllByRole('gridcell');
    fireEvent.click(cells[10]);
    expect(clickedDay).toBeDefined();
    expect(clickedDay!.date).toBeTruthy();
  });

  it('shows tooltip on hover', () => {
    render(<ContributionHeatmap data={SAMPLE_DATA} unit="tokens" />);
    const cells = screen.getAllByRole('gridcell');
    fireEvent.mouseEnter(cells[0]);
    // Tooltip should appear
    const tooltips = document.querySelectorAll('[class*="pointer-events-none"]');
    expect(tooltips.length).toBeGreaterThan(0);
  });

  it('applies custom cellSize and gap', () => {
    const { container } = render(
      <ContributionHeatmap data={SAMPLE_DATA} cellSize={8} gap={1} />,
    );
    // Just verify it renders without errors
    expect(container.firstChild).toBeTruthy();
  });
});
