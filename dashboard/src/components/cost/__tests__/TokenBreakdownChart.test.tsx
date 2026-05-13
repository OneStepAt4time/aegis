/**
 * TokenBreakdownChart.test.tsx — Tests for token breakdown chart.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenBreakdownChart } from '../TokenBreakdownChart';

describe('TokenBreakdownChart', () => {
  it('renders with mock data by default', () => {
    const { container } = render(<TokenBreakdownChart />);
    expect(container.querySelector('section')).toBeTruthy();
    expect(screen.getByText('Token Breakdown')).toBeTruthy();
  });

  it('renders empty state when data is empty array', () => {
    render(<TokenBreakdownChart data={[]} />);
    expect(screen.getByText(/No token data available yet/)).toBeTruthy();
  });

  it('renders loading state', () => {
    render(<TokenBreakdownChart loading />);
    expect(screen.getByText('Token Breakdown')).toBeTruthy();
  });

  it('renders with custom data', () => {
    const data = [
      { date: '2026-05-01', inputTokens: 10000, outputTokens: 5000, cacheReadTokens: 3000, cacheWriteTokens: 1000 },
    ];
    render(<TokenBreakdownChart data={data} />);
    expect(screen.getByText('Token Breakdown')).toBeTruthy();
  });

  it('has correct aria-label', () => {
    render(<TokenBreakdownChart />);
    expect(screen.getByLabelText('Token breakdown chart')).toBeTruthy();
  });
});
