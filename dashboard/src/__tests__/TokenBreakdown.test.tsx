import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenBreakdown } from '../components/session/TokenBreakdown';

describe('TokenBreakdown', () => {
  it('renders all four token bars', () => {
    render(
      <TokenBreakdown
        inputTokens={1000}
        outputTokens={500}
        cacheCreationTokens={200}
        cacheReadTokens={300}
        estimatedCostUsd={0.05}
      />
    );
    expect(screen.getByText('Input')).toBeDefined();
    expect(screen.getByText('Output')).toBeDefined();
    expect(screen.getByText('Cache Create')).toBeDefined();
    expect(screen.getByText('Cache Read')).toBeDefined();
  });

  it('formats large token counts with K suffix', () => {
    render(<TokenBreakdown inputTokens={15000} outputTokens={2500000} />);
    expect(screen.getByText('15.0K')).toBeDefined();
    expect(screen.getByText('2.5M')).toBeDefined();
  });

  it('renders cost when provided', () => {
    render(<TokenBreakdown estimatedCostUsd={0.1234} />);
    // 0.1234 > 0.01 so .toFixed(3) renders $0.123
    expect(screen.getByText('$0.123')).toBeDefined();
  });

  it('handles zero tokens gracefully', () => {
    const { container } = render(<TokenBreakdown />);
    expect(container.textContent).toContain('Input');
    expect(container.textContent).toContain('Output');
  });
});
