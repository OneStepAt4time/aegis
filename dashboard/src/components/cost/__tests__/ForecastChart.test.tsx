/**
 * ForecastChart.test.tsx — Tests for forecast chart component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ForecastChart } from '../ForecastChart';

const MOCK_DATE = new Date('2026-05-11T12:00:00Z');

describe('ForecastChart', () => {
  beforeEach(() => {
    vi.setSystemTime(MOCK_DATE);
  });

  it('shows empty state when no data', () => {
    render(<ForecastChart dailyTrends={[]} />);
    expect(screen.getByText('Cost Forecast')).toBeDefined();
    expect(screen.getByText(/Not enough data/)).toBeDefined();
  });

  it('shows empty state with single data point', () => {
    const trends = [
      { date: '2026-05-11', estimatedCostUsd: 5.00, sessions: 2 },
    ];
    render(<ForecastChart dailyTrends={trends} />);
    // Single point still renders (no projection possible)
    expect(screen.getByText('Cost Forecast')).toBeDefined();
  });

  it('renders chart with multiple data points', () => {
    const trends = [
      { date: '2026-05-09', estimatedCostUsd: 10.00, sessions: 5 },
      { date: '2026-05-10', estimatedCostUsd: 12.00, sessions: 6 },
      { date: '2026-05-11', estimatedCostUsd: 8.00, sessions: 4 },
    ];
    render(<ForecastChart dailyTrends={trends} />);
    expect(screen.getByText('Cost Forecast')).toBeDefined();
  });

  it('shows projected total when enough data', () => {
    const trends = [
      { date: '2026-05-09', estimatedCostUsd: 10.00, sessions: 5 },
      { date: '2026-05-10', estimatedCostUsd: 10.00, sessions: 3 },
    ];
    render(<ForecastChart dailyTrends={trends} />);
    expect(screen.getByText(/Projected total:/)).toBeDefined();
  });

  it('renders with monthly cap', () => {
    const trends = [
      { date: '2026-05-09', estimatedCostUsd: 10.00, sessions: 5 },
      { date: '2026-05-10', estimatedCostUsd: 10.00, sessions: 3 },
    ];
    render(<ForecastChart dailyTrends={trends} monthlyCap={500} />);
    expect(screen.getByText('Cost Forecast')).toBeDefined();
  });

  it('renders with zero cap (no reference line issues)', () => {
    const trends = [
      { date: '2026-05-09', estimatedCostUsd: 10.00, sessions: 5 },
      { date: '2026-05-10', estimatedCostUsd: 10.00, sessions: 3 },
    ];
    render(<ForecastChart dailyTrends={trends} monthlyCap={0} />);
    expect(screen.getByText('Cost Forecast')).toBeDefined();
  });
});
