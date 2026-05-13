/**
 * CostByModelChart.test.tsx — Tests for cost by model chart.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostByModelChart } from '../CostByModelChart';

describe('CostByModelChart', () => {
  it('renders with mock data by default', () => {
    const { container } = render(<CostByModelChart />);
    expect(container.querySelector('section')).toBeTruthy();
    expect(screen.getByText('Cost by Model')).toBeTruthy();
  });

  it('renders empty state when data is empty array', () => {
    render(<CostByModelChart data={[]} />);
    expect(screen.getByText(/No model cost data available yet/)).toBeTruthy();
  });

  it('renders loading state', () => {
    render(<CostByModelChart loading />);
    expect(screen.getByText('Cost by Model')).toBeTruthy();
  });

  it('renders with custom data', () => {
    const data = [
      { model: 'claude-opus-4.7', cost: 50 },
      { model: 'claude-sonnet-4.6', cost: 30 },
    ];
    render(<CostByModelChart data={data} />);
    expect(screen.getByText('Cost by Model')).toBeTruthy();
  });

  it('has correct aria-label', () => {
    render(<CostByModelChart />);
    expect(screen.getByLabelText('Cost by model chart')).toBeTruthy();
  });
});
