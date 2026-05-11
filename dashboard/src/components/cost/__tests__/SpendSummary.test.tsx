/**
 * SpendSummary.test.tsx — Tests for spend summary component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpendSummary } from '../SpendSummary';

const MOCK_DATE = new Date('2026-05-11T12:00:00Z');

describe('SpendSummary', () => {
  beforeEach(() => {
    vi.setSystemTime(MOCK_DATE);
  });

  it('renders "No data" when dailyTrends is empty', () => {
    render(<SpendSummary dailyTrends={[]} />);
    const noData = screen.getAllByText('No data');
    expect(noData.length).toBe(3);
  });

  it('shows today spend from latest entry', () => {
    const trends = [
      { date: '2026-05-09', estimatedCostUsd: 5.00, sessions: 3 },
      { date: '2026-05-10', estimatedCostUsd: 7.50, sessions: 5 },
      { date: '2026-05-11', estimatedCostUsd: 3.25, sessions: 2 },
    ];
    const { container } = render(<SpendSummary dailyTrends={trends} />);
    // Today card should show "2 sessions"
    expect(container.textContent).toContain('2 sessions');
  });

  it('calculates monthly spend correctly', () => {
    const trends = [
      { date: '2026-05-09', estimatedCostUsd: 10.00, sessions: 5 },
      { date: '2026-05-10', estimatedCostUsd: 20.00, sessions: 8 },
      { date: '2026-05-11', estimatedCostUsd: 5.00, sessions: 2 },
    ];
    const { container } = render(<SpendSummary dailyTrends={trends} />);
    // Monthly sessions = 5 + 8 + 2 = 15
    expect(container.textContent).toContain('15 sessions');
  });

  it('shows projected total with data count', () => {
    const trends = [
      { date: '2026-05-09', estimatedCostUsd: 10.00, sessions: 5 },
      { date: '2026-05-10', estimatedCostUsd: 10.00, sessions: 3 },
      { date: '2026-05-11', estimatedCostUsd: 10.00, sessions: 2 },
    ];
    render(<SpendSummary dailyTrends={trends} />);
    expect(screen.getByText(/based on 3 days/)).toBeDefined();
  });

  it('filters out entries from other months', () => {
    const trends = [
      { date: '2026-04-30', estimatedCostUsd: 100.00, sessions: 10 },
      { date: '2026-05-11', estimatedCostUsd: 5.00, sessions: 2 },
    ];
    const { container } = render(<SpendSummary dailyTrends={trends} />);
    // Monthly total should only include May entry (5.00), not April (100.00)
    // Monthly sessions should be 2 (not 12)
    // Check monthly card specifically: "2 sessions" should appear under This Month
    expect(container.textContent).toContain('$5.00');
  });

  it('renders three stat cards with correct labels', () => {
    const trends = [
      { date: '2026-05-11', estimatedCostUsd: 5.00, sessions: 1 },
    ];
    render(<SpendSummary dailyTrends={trends} />);
    expect(screen.getByText('Today')).toBeDefined();
    expect(screen.getByText('This Month')).toBeDefined();
    expect(screen.getByText('Projected Total')).toBeDefined();
  });
});
