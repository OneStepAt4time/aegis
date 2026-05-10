/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ContextWindowMeter } from '../ContextWindowMeter';

describe('ContextWindowMeter', () => {
  it('renders with low usage', () => {
    render(<ContextWindowMeter usedTokens={10_000} maxTokens={200_000} />);
    const bar = screen.getByLabelText(/Context usage: 5%/);
    expect(bar).toBeDefined();
    expect(bar?.getAttribute('aria-valuenow')).toBe('10000');
    expect(bar?.getAttribute('aria-valuemax')).toBe('200000');
  });

  it('renders with medium usage', () => {
    render(<ContextWindowMeter usedTokens={120_000} maxTokens={200_000} />);
    const bar = screen.getByLabelText(/Context usage: 60%/);
    expect(bar).toBeDefined();
  });

  it('renders with high usage and warning', () => {
    render(<ContextWindowMeter usedTokens={180_000} maxTokens={200_000} />);
    const bar = screen.getByLabelText(/Context usage: 90%/);
    expect(bar).toBeDefined();
    expect(screen.getByText(/nearly full/)).toBeDefined();
  });

  it('renders compact mode', () => {
    render(<ContextWindowMeter usedTokens={50_000} maxTokens={200_000} compact />);
    expect(screen.getByLabelText(/Context usage: 25%/)).toBeDefined();
  });

  it('hides label when showLabel is false', () => {
    const { container } = render(<ContextWindowMeter usedTokens={10_000} maxTokens={200_000} showLabel={false} />);
    // Should still render the bar but without label text
    expect(container.querySelector('[role="progressbar"]')).toBeDefined();
    // No "Context Window" label
    expect(screen.queryByText('Context Window')).toBeNull();
  });

  it('caps percentage at 100%', () => {
    render(<ContextWindowMeter usedTokens={300_000} maxTokens={200_000} />);
    expect(screen.getByLabelText(/Context usage: 100%/)).toBeDefined();
  });

  it('uses default 200K context window', () => {
    render(<ContextWindowMeter usedTokens={100_000} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeDefined();
    expect(bar?.getAttribute('aria-valuemax')).toBe('200000');
  });

  it('shows warning at 75% usage', () => {
    render(<ContextWindowMeter usedTokens={150_000} maxTokens={200_000} />);
    expect(screen.getByText(/filling up/)).toBeDefined();
  });
});
