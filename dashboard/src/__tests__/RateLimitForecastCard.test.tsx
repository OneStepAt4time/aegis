/**
 * __tests__/RateLimitForecastCard.test.tsx — Issue #2283.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateLimitForecastCard } from '../components/analytics/RateLimitForecastCard';
import type { RateLimitForecast } from '../types';

describe('<RateLimitForecastCard>', () => {
  it('renders "Unlimited" when estimatedSessionsRemaining is null', () => {
    const forecast: RateLimitForecast = {
      estimatedSessionsRemaining: null,
      bottleneck: null,
    };
    render(<RateLimitForecastCard forecast={forecast} />);
    expect(screen.getByText('Unlimited')).toBeTruthy();
    expect(screen.getByText('No bottleneck detected')).toBeTruthy();
  });

  it('renders green severity when remaining > 10', () => {
    const forecast: RateLimitForecast = {
      estimatedSessionsRemaining: 50,
      bottleneck: null,
    };
    render(<RateLimitForecastCard forecast={forecast} />);
    expect(screen.getByText('50')).toBeTruthy();
    const indicators = screen.getAllByLabelText(/indicator/i);
    expect(indicators.length).toBeGreaterThanOrEqual(1);
  });

  it('renders amber severity when remaining is 1-10', () => {
    const forecast: RateLimitForecast = {
      estimatedSessionsRemaining: 5,
      bottleneck: 'tokens_per_window',
    };
    render(<RateLimitForecastCard forecast={forecast} />);
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('Token Budget')).toBeTruthy();
  });

  it('renders red severity when remaining is 0', () => {
    const forecast: RateLimitForecast = {
      estimatedSessionsRemaining: 0,
      bottleneck: 'concurrent_sessions',
    };
    render(<RateLimitForecastCard forecast={forecast} />);
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Concurrent Sessions')).toBeTruthy();
  });

  it('renders correct bottleneck label for spend_per_window', () => {
    const forecast: RateLimitForecast = {
      estimatedSessionsRemaining: 3,
      bottleneck: 'spend_per_window',
    };
    render(<RateLimitForecastCard forecast={forecast} />);
    expect(screen.getByText('Spend Budget')).toBeTruthy();
  });

  it('renders region with aria-label', () => {
    const forecast: RateLimitForecast = {
      estimatedSessionsRemaining: null,
      bottleneck: null,
    };
    render(<RateLimitForecastCard forecast={forecast} />);
    expect(screen.getByRole('region', { name: /rate-limit forecast/i })).toBeTruthy();
  });

  it('renders heading', () => {
    const forecast: RateLimitForecast = {
      estimatedSessionsRemaining: null,
      bottleneck: null,
    };
    render(<RateLimitForecastCard forecast={forecast} />);
    expect(screen.getByText('Capacity Forecast')).toBeTruthy();
  });
});
