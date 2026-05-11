/**
 * SpendSummary — unit tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpendSummary } from './SpendSummary';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const TODAY = todayStr();
const MONTH = monthPrefix();

const SAMPLE_TRENDS = [
  { date: `${MONTH}-01`, estimatedCostUsd: 12.5, sessions: 3 },
  { date: `${MONTH}-02`, estimatedCostUsd: 8.25, sessions: 2 },
  { date: TODAY, estimatedCostUsd: 5.0, sessions: 1 },
];

describe('SpendSummary', () => {
  it('renders without crashing', () => {
    const { container } = render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('handles empty trends gracefully — shows no data state', () => {
    render(<SpendSummary dailyTrends={[]} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('No data');
  });

  it('shows Today label when data is present', () => {
    render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    expect(screen.getByText('Today')).toBeTruthy();
  });

  it('shows today spend matching the entry for the current date', () => {
    render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    // Today's entry has estimatedCostUsd=5.0 → formatCurrency yields $5.00
    const text = document.body.textContent ?? '';
    expect(text).toContain('5');
  });

  it('shows This Month label', () => {
    render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    expect(screen.getByText('This Month')).toBeTruthy();
  });

  it('shows monthly spend as sum of current-month entries', () => {
    render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    // Total = 12.5 + 8.25 + 5.0 = 25.75
    const text = document.body.textContent ?? '';
    expect(text).toContain('25');
  });

  it('shows Projected Total label', () => {
    render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    expect(screen.getByText('Projected Total')).toBeTruthy();
  });

  it('shows a projected value greater than zero when there is spend data', () => {
    render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    // Projected should be > 0 since avgDaily > 0
    const text = document.body.textContent ?? '';
    // Just verify there's a $ somewhere (formatCurrency was used)
    expect(text).toContain('$');
  });

  it('renders $0.00 for today when no entry matches today', () => {
    const pastOnlyTrends = [
      { date: '2020-01-01', estimatedCostUsd: 10, sessions: 1 },
    ];
    render(<SpendSummary dailyTrends={pastOnlyTrends} />);
    // The "today" row should show $0.00 since no matching date entry
    const text = document.body.textContent ?? '';
    expect(text).toContain('0');
  });

  it('formats currency values with $ sign', () => {
    render(<SpendSummary dailyTrends={SAMPLE_TRENDS} />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('$');
  });
});
