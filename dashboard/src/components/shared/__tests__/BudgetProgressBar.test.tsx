/**
 * BudgetProgressBar.test.tsx — Tests for budget progress bar component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BudgetProgressBar } from '../BudgetProgressBar';

describe('BudgetProgressBar', () => {
  it('renders with low spend (green, <50%)', () => {
    render(<BudgetProgressBar currentSpend={25} cap={100} label="Daily" period="today" />);
    expect(screen.getByText('25%')).toBeDefined();
    // Outer container has aria-label with budget details
    const outer = screen.getByLabelText(/^Daily budget:/);
    expect(outer).toBeDefined();
  });

  it('renders with medium spend (amber, 50-80%)', () => {
    render(<BudgetProgressBar currentSpend={60} cap={100} label="Monthly" period="May 2026" />);
    expect(screen.getByText('60%')).toBeDefined();
  });

  it('renders with high spend (red, >80%)', () => {
    render(<BudgetProgressBar currentSpend={90} cap={100} label="Daily" period="today" />);
    expect(screen.getByText('90%')).toBeDefined();
  });

  it('renders with over-budget spend (>100%)', () => {
    render(<BudgetProgressBar currentSpend={110} cap={100} label="Daily" period="today" />);
    expect(screen.getByText('110%')).toBeDefined();
  });

  it('handles zero cap (unlimited)', () => {
    render(<BudgetProgressBar currentSpend={50} cap={0} label="Daily" period="today" />);
    expect(screen.getByText('No limit set')).toBeDefined();
  });

  it('handles negative cap (unlimited)', () => {
    render(<BudgetProgressBar currentSpend={50} cap={-10} label="Daily" period="today" />);
    expect(screen.getByText('No limit set')).toBeDefined();
  });

  it('has a progressbar role with aria values', () => {
    render(<BudgetProgressBar currentSpend={50} cap={100} label="Daily" period="today" />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toBeDefined();
    expect(progressbar.getAttribute('aria-valuenow')).toBe('50');
    expect(progressbar.getAttribute('aria-valuemin')).toBe('0');
    expect(progressbar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('shows label text', () => {
    render(<BudgetProgressBar currentSpend={10} cap={100} label="Daily" period="today" />);
    expect(screen.getByText('Daily Budget')).toBeDefined();
  });

  it('does not render progressbar when cap is zero', () => {
    render(<BudgetProgressBar currentSpend={50} cap={0} label="Daily" period="today" />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
