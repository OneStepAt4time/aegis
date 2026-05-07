/**
 * __tests__/ModelDistributionBar.test.tsx — Tests for CCMeter-inspired model distribution.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelDistributionBar } from '../components/analytics/ModelDistributionBar';

describe('ModelDistributionBar', () => {
  it('renders segments as colored bars', () => {
    const { container } = render(
      <ModelDistributionBar
        segments={[
          { model: 'claude-opus-4.7', fraction: 0.5 },
          { model: 'claude-sonnet-4.6', fraction: 0.3 },
          { model: 'claude-haiku-4.5', fraction: 0.2 },
        ]}
      />
    );
    const bar = container.querySelector('.flex.overflow-hidden.rounded-full');
    expect(bar).not.toBeNull();
    const segments = bar!.children;
    expect(segments.length).toBe(3);
  });

  it('renders legend with percentages', () => {
    render(
      <ModelDistributionBar
        showLegend
        segments={[
          { model: 'claude-opus-4.7', fraction: 0.6 },
          { model: 'claude-sonnet-4.6', fraction: 0.4 },
        ]}
      />
    );
    expect(screen.getByText('Opus')).not.toBeNull();
    expect(screen.getByText('Sonnet')).not.toBeNull();
    expect(screen.getByText('60%')).not.toBeNull();
    expect(screen.getByText('40%')).not.toBeNull();
  });

  it('hides legend when showLegend=false', () => {
    render(
      <ModelDistributionBar
        showLegend={false}
        segments={[
          { model: 'claude-opus-4.7', fraction: 1.0 },
        ]}
      />
    );
    expect(screen.queryByText('Opus')).toBeNull();
  });

  it('renders empty state', () => {
    render(<ModelDistributionBar segments={[]} />);
    expect(screen.getByText('No model data')).not.toBeNull();
  });

  it('renders custom label on segments', () => {
    render(
      <ModelDistributionBar
        showLegend
        segments={[
          { model: 'gpt-4', fraction: 1.0, label: 'GPT-4' },
        ]}
      />
    );
    expect(screen.getByText('GPT-4')).not.toBeNull();
  });

  it('normalizes fractions that do not sum to 1', () => {
    render(
      <ModelDistributionBar
        showLegend
        segments={[
          { model: 'claude-opus-4.7', fraction: 3 },
          { model: 'claude-sonnet-4.6', fraction: 1 },
        ]}
      />
    );
    // 3/4 = 75%, 1/4 = 25%
    expect(screen.getByText('75%')).not.toBeNull();
    expect(screen.getByText('25%')).not.toBeNull();
  });

  it('filters out near-zero segments from legend', () => {
    render(
      <ModelDistributionBar
        showLegend
        segments={[
          { model: 'claude-opus-4.7', fraction: 0.99 },
          { model: 'claude-sonnet-4.6', fraction: 0.005 },
        ]}
      />
    );
    // Opus should show (99%), Sonnet should not show (< 1%)
    expect(screen.getByText('Opus')).not.toBeNull();
    expect(screen.queryByText('Sonnet')).toBeNull();
  });
});
