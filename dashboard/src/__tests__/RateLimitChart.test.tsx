/**
 * __tests__/RateLimitChart.test.tsx — Issue #2283.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateLimitChart, barColor } from '../components/analytics/RateLimitChart';
import type { RateLimitKeyUsage } from '../types';

const makeKey = (overrides: Partial<RateLimitKeyUsage> = {}): RateLimitKeyUsage => ({
  keyId: 'k1',
  keyName: 'test-key',
  activeSessions: 5,
  maxSessions: 10,
  tokensInWindow: 5000,
  maxTokens: 10000,
  spendInWindowUsd: 1.5,
  maxSpendUsd: 5.0,
  windowMs: 60000,
  ...overrides,
});

describe('barColor', () => {
  it('returns cyan below 66%', () => {
    expect(barColor(0)).toBe('var(--color-accent-cyan)');
    expect(barColor(0.5)).toBe('var(--color-accent-cyan)');
    expect(barColor(0.65)).toBe('var(--color-accent-cyan)');
  });

  it('returns amber between 66% and 90%', () => {
    expect(barColor(0.66)).toBe('var(--color-warning)');
    expect(barColor(0.75)).toBe('var(--color-warning)');
    expect(barColor(0.89)).toBe('var(--color-warning)');
  });

  it('returns red at 90% and above', () => {
    expect(barColor(0.9)).toBe('var(--color-danger)');
    expect(barColor(1.0)).toBe('var(--color-danger)');
    expect(barColor(1.5)).toBe('var(--color-danger)');
  });
});

describe('<RateLimitChart>', () => {
  it('renders empty state when no keys', () => {
    render(<RateLimitChart perKey={[]} />);
    expect(screen.getByText('No rate-limit data available')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders chart section with data', () => {
    const keys = [
      makeKey({ keyId: 'k1', keyName: 'alpha' }),
      makeKey({ keyId: 'k2', keyName: 'beta' }),
    ];
    render(<RateLimitChart perKey={keys} />);
    // recharts SVG may not render in jsdom (no layout dimensions),
    // but the section wrapper and heading should always appear
    expect(screen.getByRole('region', { name: /rate-limit usage/i })).toBeTruthy();
    expect(screen.getByText('Per-Key Rate-Limit Usage')).toBeTruthy();
  });

  it('renders region with aria-label', () => {
    const keys = [makeKey()];
    render(<RateLimitChart perKey={keys} />);
    expect(screen.getByRole('region', { name: /rate-limit usage/i })).toBeTruthy();
  });

  it('renders heading', () => {
    render(<RateLimitChart perKey={[makeKey()]} />);
    expect(screen.getByText('Per-Key Rate-Limit Usage')).toBeTruthy();
  });

  it('handles null max values gracefully', () => {
    const keys = [makeKey({ maxSessions: null, maxTokens: null, maxSpendUsd: null })];
    // Should render without error — ratios default to 0 for null max values
    render(<RateLimitChart perKey={keys} />);
    // The section region should render regardless of recharts SVG behavior
    expect(screen.getByRole('region', { name: /rate-limit usage/i })).toBeTruthy();
  });
});
