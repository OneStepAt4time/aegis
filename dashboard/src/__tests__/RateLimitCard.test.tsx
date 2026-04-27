/**
 * __tests__/RateLimitCard.test.tsx — Issue 04.8 of the session-cockpit epic.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateLimitCard, limitBarColor } from '../components/session/RateLimitCard';

describe('limitBarColor (pure)', () => {
  it('uses the accent below 66%', () => {
    expect(limitBarColor(0)).toContain('accent');
    expect(limitBarColor(0.5)).toContain('accent');
    expect(limitBarColor(0.65)).toContain('accent');
  });
  it('uses warning between 66% and 90%', () => {
    expect(limitBarColor(0.66)).toContain('warning');
    expect(limitBarColor(0.75)).toContain('warning');
    expect(limitBarColor(0.89)).toContain('warning');
  });
  it('uses danger at 90% and above', () => {
    expect(limitBarColor(0.9)).toContain('danger');
    expect(limitBarColor(1)).toContain('danger');
    expect(limitBarColor(1.5)).toContain('danger');
  });
});

describe('<RateLimitCard>', () => {
  it('renders the unavailable notice when limits is null', () => {
    render(<RateLimitCard limits={null} />);
    expect(
      screen.getByText(/Rate limits not reported by the current provider/),
    ).toBeDefined();
  });

  it('renders waiting notice for empty limits array', () => {
    render(<RateLimitCard limits={[]} />);
    expect(screen.getByText(/Rate limit · waiting for samples/)).toBeDefined();
  });

  it('renders one row per window with used/total and percentage', () => {
    render(
      <RateLimitCard
        limits={[
          { label: '5h', used: 3_050, total: 5_000, unit: 'req' },
          { label: '7d', used: 900, total: 10_000, unit: 'req' },
        ]}
      />,
    );
    expect(screen.getByText('5h')).toBeDefined();
    expect(screen.getByText('7d')).toBeDefined();
    expect(screen.getByText('61%')).toBeDefined();
    expect(screen.getByText('9%')).toBeDefined();
    // Match locale-agnostically — jsdom's default locale may emit
    // `3050`, `3,050`, or `3.050` depending on the host environment.
    const bodyText = (document.body.textContent ?? '').replace(/[,.]/g, '');
    expect(bodyText).toContain('3050');
    expect(bodyText).toContain('5000');
    expect(bodyText).toContain('900');
    expect(bodyText).toContain('10000');
  });

  it('renders the forecast line when provided', () => {
    render(
      <RateLimitCard
        forecast="5h cap in ~41m"
        limits={[{ label: '5h', used: 4_100, total: 5_000 }]}
      />,
    );
    expect(screen.getByText(/Forecast: 5h cap in ~41m/)).toBeDefined();
  });

  it('shows ∞ and em-dash for uncapped windows', () => {
    render(
      <RateLimitCard limits={[{ label: 'Opus', used: 100, total: Infinity }]} />,
    );
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('∞');
    expect(bodyText).toContain('—');
  });
});
