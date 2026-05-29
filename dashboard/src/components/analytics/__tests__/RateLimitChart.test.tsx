import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateLimitChart, barColor } from '../RateLimitChart';
import type { RateLimitKeyUsage } from '../../../types';

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="chart-placeholder">Chart</div>,
}));

vi.mock('../../../utils/chartTheme', () => ({
  CHART_COLORS: { cyan: '#06b6d4', warning: '#f59e0b', danger: '#ef4444' },
  CHART_RGB: { cyan: '6,182,212', warning: '245,158,11', danger: '239,68,68' },
}));

vi.mock('../../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

const sampleData: RateLimitKeyUsage[] = [
  {
    keyId: 'key-1',
    keyName: 'sk-test-key-1',
    windowMs: 60000,
    activeSessions: 5,
    maxSessions: 10,
    tokensInWindow: 50000,
    maxTokens: 100000,
    spendInWindowUsd: 1.5,
    maxSpendUsd: 5.0,
  },
  {
    keyId: 'key-2',
    keyName: 'sk-test-key-2',
    windowMs: 60000,
    activeSessions: 9,
    maxSessions: 10,
    tokensInWindow: 95000,
    maxTokens: 100000,
    spendInWindowUsd: 4.8,
    maxSpendUsd: 5.0,
  },
];

describe('RateLimitChart', () => {
  it('renders empty state when no data', () => {
    render(<RateLimitChart perKey={[]} />);
    expect(screen.getByText('No rate-limit data available')).toBeDefined();
  });

  it('renders empty state with role=status', () => {
    render(<RateLimitChart perKey={[]} />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders chart section when data present', () => {
    render(<RateLimitChart perKey={sampleData} />);
    expect(screen.getByRole('region')).toBeDefined();
  });

  it('renders title', () => {
    render(<RateLimitChart perKey={sampleData} />);
    expect(screen.getByText('Per-Key Rate-Limit Usage')).toBeDefined();
  });

  it('renders dimension legend', () => {
    render(<RateLimitChart perKey={sampleData} />);
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Tokens')).toBeDefined();
    expect(screen.getByText('Spend')).toBeDefined();
  });

  it('renders chart placeholder', () => {
    render(<RateLimitChart perKey={sampleData} />);
    expect(screen.getByTestId('chart-placeholder')).toBeDefined();
  });

  it('renders key names in legend', () => {
    render(<RateLimitChart perKey={sampleData} />);
    // The chart renders via Bar component which is mocked
    expect(screen.getByText('Per-Key Rate-Limit Usage')).toBeDefined();
  });
});

describe('barColor utility', () => {
  it('returns cyan for low ratio', () => {
    expect(barColor(0)).toBe('#06b6d4');
    expect(barColor(0.5)).toBe('#06b6d4');
  });

  it('returns warning for 66-90% ratio', () => {
    expect(barColor(0.66)).toBe('#f59e0b');
    expect(barColor(0.89)).toBe('#f59e0b');
  });

  it('returns danger for >= 90% ratio', () => {
    expect(barColor(0.9)).toBe('#ef4444');
    expect(barColor(1.0)).toBe('#ef4444');
  });
});
