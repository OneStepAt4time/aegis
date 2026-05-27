import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelDistributionBar } from '../ModelDistributionBar';

describe('ModelDistributionBar', () => {
  const segments = [
    { model: 'claude-opus-4.7', fraction: 0.3 },
    { model: 'claude-sonnet-4.6', fraction: 0.5 },
    { model: 'claude-haiku-3.5', fraction: 0.2 },
  ];

  it('renders empty state when no segments', () => {
    render(<ModelDistributionBar segments={[]} />);
    expect(screen.getByText('No model data')).toBeDefined();
  });

  it('renders stacked bar with role="img"', () => {
    render(<ModelDistributionBar segments={segments} />);
    expect(screen.getByRole('img')).toBeDefined();
  });

  it('renders correct number of bar segments', () => {
    const { container } = render(<ModelDistributionBar segments={segments} />);
    const bars = container.querySelectorAll('.transition-all');
    expect(bars).toHaveLength(3);
  });

  it('renders legend with model labels', () => {
    render(<ModelDistributionBar segments={segments} showLegend />);
    expect(screen.getByText('Opus')).toBeDefined();
    expect(screen.getByText('Sonnet')).toBeDefined();
    expect(screen.getByText('Haiku')).toBeDefined();
  });

  it('renders percentage in legend', () => {
    render(<ModelDistributionBar segments={segments} />);
    expect(screen.getByText('30%')).toBeDefined();
    expect(screen.getByText('50%')).toBeDefined();
    expect(screen.getByText('20%')).toBeDefined();
  });

  it('hides legend when showLegend=false', () => {
    const { container } = render(<ModelDistributionBar segments={segments} showLegend={false} />);
    const legend = container.querySelector('.flex-wrap');
    expect(legend).toBeNull();
  });

  it('normalizes fractions that dont sum to 1', () => {
    const unnormalized = [
      { model: 'opus', fraction: 3 },
      { model: 'sonnet', fraction: 7 },
    ];
    const { container } = render(<ModelDistributionBar segments={unnormalized} />);
    const bars = container.querySelectorAll('.transition-all');
    expect((bars[0] as HTMLElement).style.width).toBe('30%');
    expect((bars[1] as HTMLElement).style.width).toBe('70%');
  });

  it('applies custom barHeight', () => {
    const { container } = render(<ModelDistributionBar segments={segments} barHeight={12} />);
    const bar = container.querySelector('.flex.overflow-hidden');
    expect((bar as HTMLElement).style.height).toBe('12px');
  });

  it('uses custom aria-label', () => {
    render(<ModelDistributionBar segments={segments} ariaLabel="Custom label" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Custom label');
  });

  it('applies custom className', () => {
    const { container } = render(<ModelDistributionBar segments={segments} className="my-bar" />);
    expect(container.firstChild).toBeDefined();
  });

  it('uses custom label override', () => {
    const withLabel = [{ model: 'unknown-model', fraction: 1, label: 'Custom Name' }];
    render(<ModelDistributionBar segments={withLabel} />);
    expect(screen.getByText('Custom Name')).toBeDefined();
  });
});
