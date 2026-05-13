/**
 * BurnRateChart.test.tsx — Tests for burn rate line chart.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BurnRateChart } from '../BurnRateChart';

describe('BurnRateChart', () => {
  it('renders with mock data by default', () => {
    const { container } = render(<BurnRateChart />);
    expect(container.querySelector('section')).toBeTruthy();
    expect(screen.getByText('Session Burn Rate')).toBeTruthy();
  });

  it('renders empty state when data is empty array', () => {
    render(<BurnRateChart data={[]} />);
    expect(screen.getByText(/No cost data available yet/)).toBeTruthy();
  });

  it('renders loading state', () => {
    render(<BurnRateChart loading />);
    expect(screen.getByText('Session Burn Rate')).toBeTruthy();
  });

  it('renders with custom data', () => {
    const data = [
      { date: '2026-05-01', cost: 3.50 },
      { date: '2026-05-02', cost: 4.20 },
      { date: '2026-05-03', cost: 5.10 },
    ];
    const { container } = render(<BurnRateChart data={data} />);
    expect(container.querySelector('section')).toBeTruthy();
    expect(screen.getByText('Session Burn Rate')).toBeTruthy();
  });

  it('has correct aria-label', () => {
    render(<BurnRateChart />);
    const section = screen.getByLabelText('Session burn rate chart');
    expect(section).toBeTruthy();
  });
});
