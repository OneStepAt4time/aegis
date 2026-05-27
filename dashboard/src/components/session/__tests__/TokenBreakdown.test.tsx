/**
 * TokenBreakdown tests — colored token usage bars for session metrics.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenBreakdown } from '../TokenBreakdown';

describe('TokenBreakdown', () => {
  it('renders with default zero values', () => {
    const { container } = render(<TokenBreakdown />);
    expect(container.querySelector('.space-y-2')).not.toBeNull();
  });

  it('renders all four bar segments', () => {
    const { container } = render(
      <TokenBreakdown inputTokens={100} outputTokens={200} cacheCreationTokens={50} cacheReadTokens={75} />,
    );
    const bars = container.querySelectorAll('.flex.h-3 > div');
    expect(bars.length).toBe(4);
  });

  it('renders legend with labels and formatted values', () => {
    render(
      <TokenBreakdown inputTokens={1500} outputTokens={2500} cacheCreationTokens={500} cacheReadTokens={800} />,
    );
    expect(screen.getByText('Input')).not.toBeNull();
    expect(screen.getByText('Output')).not.toBeNull();
    expect(screen.getByText('Cache Create')).not.toBeNull();
    expect(screen.getByText('Cache Read')).not.toBeNull();
    // 1500 → "1.5K", 2500 → "2.5K", 500 → "500", 800 → "800"
    expect(screen.getByText('1.5K')).not.toBeNull();
    expect(screen.getByText('2.5K')).not.toBeNull();
    expect(screen.getByText('500')).not.toBeNull();
    expect(screen.getByText('800')).not.toBeNull();
  });

  it('formats millions correctly', () => {
    render(<TokenBreakdown inputTokens={2_500_000} />);
    expect(screen.getByText('2.5M')).not.toBeNull();
  });

  it('formats thousands correctly', () => {
    render(<TokenBreakdown inputTokens={12000} />);
    expect(screen.getByText('12.0K')).not.toBeNull();
  });

  it('shows cost when estimatedCostUsd is provided', () => {
    render(<TokenBreakdown estimatedCostUsd={0.05} />);
    expect(screen.getByText('$0.050')).not.toBeNull();
  });

  it('shows cost with 4 decimal places for tiny values', () => {
    render(<TokenBreakdown estimatedCostUsd={0.003} />);
    expect(screen.getByText('$0.0030')).not.toBeNull();
  });

  it('hides cost section when estimatedCostUsd is null', () => {
    render(<TokenBreakdown estimatedCostUsd={null} />);
    expect(screen.queryByText('Cost')).toBeNull();
  });

  it('hides cost section when estimatedCostUsd is undefined', () => {
    render(<TokenBreakdown />);
    expect(screen.queryByText('Cost')).toBeNull();
  });

  it('sets minWidth 2 on bars with value > 0', () => {
    const { container } = render(
      <TokenBreakdown inputTokens={100} outputTokens={0} />,
    );
    const bars = container.querySelectorAll('.flex.h-3 > div');
    // input bar should have minWidth 2
    const inputStyle = bars[0].getAttribute('style');
    expect(inputStyle).toContain('min-width: 2px');
    // output bar should have minWidth 0
    const outputStyle = bars[1].getAttribute('style');
    expect(outputStyle).toContain('min-width: 0px');
  });

  it('bar titles show label and token count', () => {
    render(<TokenBreakdown inputTokens={500} />);
    const inputBar = screen.getByTitle('Input: 500');
    expect(inputBar).not.toBeNull();
  });

  it('renders legend color dots', () => {
    const { container } = render(<TokenBreakdown inputTokens={100} />);
    const dots = container.querySelectorAll('.w-2.h-2.rounded-full');
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it('handles all zeros gracefully', () => {
    const { container } = render(
      <TokenBreakdown inputTokens={0} outputTokens={0} cacheCreationTokens={0} cacheReadTokens={0} />,
    );
    const bars = container.querySelectorAll('.flex.h-3 > div');
    expect(bars.length).toBe(4);
    // total = Math.max(0+0+0+0, 1) = 1, so width is 0%
    bars.forEach((bar) => {
      const style = bar.getAttribute('style');
      expect(style).toContain('width: 0%');
    });
  });

  it('handles null token values as zero', () => {
    const { container } = render(
      <TokenBreakdown inputTokens={null} outputTokens={null} cacheCreationTokens={null} cacheReadTokens={null} />,
    );
    const bars = container.querySelectorAll('.flex.h-3 > div');
    expect(bars.length).toBe(4);
  });
});
