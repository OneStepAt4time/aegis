/**
 * ModelDistributionBar — unit tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelDistributionBar } from './ModelDistributionBar';

const SAMPLE_SEGMENTS = [
  { model: 'claude-opus-4.7', value: 6400 },
  { model: 'claude-sonnet-4.6', value: 3100 },
  { model: 'claude-haiku-4.5', value: 500 },
];

describe('ModelDistributionBar', () => {
  it('renders without crashing', () => {
    const { container } = render(<ModelDistributionBar segments={SAMPLE_SEGMENTS} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('shows accessible image label', () => {
    render(<ModelDistributionBar segments={SAMPLE_SEGMENTS} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toContain('claude-opus');
  });

  it('shows legend in expanded mode', () => {
    render(<ModelDistributionBar segments={SAMPLE_SEGMENTS} />);
    // Should show model names in legend
    expect(screen.getByText('claude-opus-4.7')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-4.6')).toBeTruthy();
  });

  it('hides legend in compact mode', () => {
    render(<ModelDistributionBar segments={SAMPLE_SEGMENTS} compact />);
    expect(screen.queryByText('claude-opus-4.7')).toBeNull();
  });

  it('handles empty segments gracefully', () => {
    render(<ModelDistributionBar segments={[]} />);
    expect(screen.getByText('No data')).toBeTruthy();
  });

  it('filters out zero-value segments', () => {
    const withZero = [...SAMPLE_SEGMENTS, { model: 'gpt-4', value: 0 }];
    render(<ModelDistributionBar segments={withZero} />);
    expect(screen.queryByText('gpt-4')).toBeNull();
  });

  it('uses custom label override', () => {
    const custom = [
      { model: 'claude-opus-4.7', value: 1000, label: 'Opus' },
    ];
    render(<ModelDistributionBar segments={custom} />);
    expect(screen.getByText('Opus')).toBeTruthy();
  });
});
