/**
 * BudgetProgressBar — unit tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BudgetProgressBar } from './BudgetProgressBar';

describe('BudgetProgressBar', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <BudgetProgressBar currentSpend={25} cap={100} label="Daily" period="today" />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('has progressbar role with correct aria attributes', () => {
    render(<BudgetProgressBar currentSpend={30} cap={100} label="Daily" period="today" />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeTruthy();
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeCloseTo(30);
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('has an aria-label on the container containing the label', () => {
    render(<BudgetProgressBar currentSpend={30} cap={100} label="Daily" period="today" />);
    const containers = document.querySelectorAll('[aria-label]');
    const labels = Array.from(containers).map((el) => el.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.toLowerCase().includes('daily'))).toBe(true);
  });

  it('applies success color class when spend is below 50%', () => {
    render(<BudgetProgressBar currentSpend={40} cap={100} label="Daily" period="today" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('success');
  });

  it('applies warning color class when spend is between 50% and 80%', () => {
    render(<BudgetProgressBar currentSpend={65} cap={100} label="Daily" period="today" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('warning');
  });

  it('applies danger color class when spend exceeds 80%', () => {
    render(<BudgetProgressBar currentSpend={85} cap={100} label="Daily" period="today" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('danger');
  });

  it('handles zero cap gracefully without crashing', () => {
    const { container } = render(
      <BudgetProgressBar currentSpend={50} cap={0} label="Daily" period="today" />,
    );
    expect(container.firstChild).toBeTruthy();
    // No progressbar shown for zero cap (no limit set)
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('clamps bar width to 100% when spend exceeds cap', () => {
    render(<BudgetProgressBar currentSpend={200} cap={100} label="Daily" period="today" />);
    const bar = screen.getByRole('progressbar');
    const width = (bar as HTMLElement).style.width;
    expect(width).toBe('100%');
  });

  it('has minimum height on the progress track for accessibility', () => {
    render(<BudgetProgressBar currentSpend={30} cap={100} label="Daily" period="today" />);
    const bar = screen.getByRole('progressbar');
    // The track container wrapping the bar has min-h-[44px]
    const track = bar.parentElement!;
    expect(track.className).toContain('min-h-');
  });

  it('renders the label text', () => {
    render(<BudgetProgressBar currentSpend={30} cap={100} label="Daily" period="today" />);
    // Label renders as "{label} Budget"
    expect(screen.getByText(/Daily/i)).toBeTruthy();
  });

  it('renders spend amount in the component', () => {
    render(<BudgetProgressBar currentSpend={30} cap={100} label="Daily" period="today" />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('30');
  });

  it('renders cap amount in the component', () => {
    render(<BudgetProgressBar currentSpend={30} cap={100} label="Daily" period="today" />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('100');
  });
});
