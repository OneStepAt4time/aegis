/**
 * RateLimitCard tests — rate-limit usage bars.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateLimitCard, limitBarColor } from '../RateLimitCard';
import type { RateLimitWindow } from '../RateLimitCard';

// Mock Icon component
vi.mock('../../Icon', () => ({
  Icon: ({ name, ...props }: { name: string; [k: string]: unknown }) =>
    <svg data-testid={`icon-${name}`} {...props} />,
}));

describe('RateLimitCard', () => {
  describe('limitBarColor helper', () => {
    it('returns danger color at 90%+ ratio', () => {
      expect(limitBarColor(0.95)).toBe('var(--color-danger)');
    });

    it('returns warning color at 66-89% ratio', () => {
      expect(limitBarColor(0.7)).toBe('var(--color-warning)');
    });

    it('returns accent color below 66% ratio', () => {
      expect(limitBarColor(0.3)).toBe('var(--color-accent-cyan)');
    });

    it('returns accent color at 0 ratio', () => {
      expect(limitBarColor(0)).toBe('var(--color-accent-cyan)');
    });
  });

  describe('null limits', () => {
    it('renders unavailable notice when limits is null', () => {
      render(<RateLimitCard limits={null} />);
      expect(screen.getByText('Rate limits not reported by the current provider.')).not.toBeNull();
    });

    it('renders Activity icon when limits is null', () => {
      render(<RateLimitCard limits={null} />);
      expect(screen.getByTestId('icon-Activity')).not.toBeNull();
    });
  });

  describe('empty limits array', () => {
    it('renders waiting message', () => {
      render(<RateLimitCard limits={[]} />);
      expect(screen.getByText('Rate limit · waiting for samples…')).not.toBeNull();
    });
  });

  describe('with limit data', () => {
    const limits: RateLimitWindow[] = [
      { label: '5h', used: 50, total: 100 },
      { label: '7d', used: 900, total: 1000 },
      { label: 'Opus', used: 5, total: 50 },
    ];

    it('renders the Rate Limit heading', () => {
      render(<RateLimitCard limits={limits} />);
      expect(screen.getByText('Rate Limit')).not.toBeNull();
    });

    it('renders all limit labels', () => {
      render(<RateLimitCard limits={limits} />);
      expect(screen.getByText('5h')).not.toBeNull();
      expect(screen.getByText('7d')).not.toBeNull();
      expect(screen.getByText('Opus')).not.toBeNull();
    });

    it('renders percentage for each window', () => {
      render(<RateLimitCard limits={limits} />);
      expect(screen.getByText('50%')).not.toBeNull(); // 50/100
      expect(screen.getByText('90%')).not.toBeNull(); // 900/1000
      expect(screen.getByText('10%')).not.toBeNull(); // 5/50
    });

    it('renders usage counters with default unit', () => {
      render(<RateLimitCard limits={limits} />);
      expect(screen.getByText(/50 \/ 100 req/)).not.toBeNull();
      expect(screen.getByText(/900 \/ 1,000 req/)).not.toBeNull();
    });

    it('renders forecast when provided', () => {
      render(<RateLimitCard limits={limits} forecast="5h in ~41m" />);
      expect(screen.getByText('Forecast: 5h in ~41m')).not.toBeNull();
    });

    it('does not render forecast when not provided', () => {
      render(<RateLimitCard limits={limits} />);
      expect(screen.queryByText(/Forecast:/)).toBeNull();
    });

    it('renders bar elements with correct widths', () => {
      const { container } = render(<RateLimitCard limits={limits} />);
      const bars = container.querySelectorAll('.h-full.rounded-full');
      // 50% → width:50%, 90% → width:90%, 10% → width:10%
      expect(bars[0].getAttribute('style')).toContain('width: 50%');
      expect(bars[1].getAttribute('style')).toContain('width: 90%');
      expect(bars[2].getAttribute('style')).toContain('width: 10%');
    });

    it('uses custom unit when provided', () => {
      const customLimits: RateLimitWindow[] = [
        { label: 'Tokens', used: 1000, total: 10000, unit: 'tok' },
      ];
      render(<RateLimitCard limits={customLimits} />);
      expect(screen.getByText(/1,000 \/ 10,000 tok/)).not.toBeNull();
    });

    it('handles Infinity total gracefully', () => {
      const infLimits: RateLimitWindow[] = [
        { label: 'NoCap', used: 42, total: Infinity },
      ];
      render(<RateLimitCard limits={infLimits} />);
      // percentage should be "—" for Infinity
      expect(screen.getByText('—')).not.toBeNull();
      expect(screen.getByText(/42 \/ ∞ req/)).not.toBeNull();
    });
  });
});
