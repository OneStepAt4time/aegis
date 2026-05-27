import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateLimitForecastCard } from '../RateLimitForecastCard';
import type { RateLimitForecast } from '../../../types';

const greenForecast: RateLimitForecast = {
  estimatedSessionsRemaining: 25,
  bottleneck: null,
};

const amberForecast: RateLimitForecast = {
  estimatedSessionsRemaining: 5,
  bottleneck: 'concurrent_sessions',
};

const unlimitedForecast: RateLimitForecast = {
  estimatedSessionsRemaining: null,
  bottleneck: null,
};

const customBottleneck: RateLimitForecast = {
  estimatedSessionsRemaining: 3,
  bottleneck: 'concurrent_sessions',
};

describe('RateLimitForecastCard', () => {
  it('renders the heading', () => {
    render(<RateLimitForecastCard forecast={greenForecast} />);
    expect(screen.getByText('Capacity Forecast')).toBeDefined();
  });

  it('displays sessions remaining for numeric value', () => {
    render(<RateLimitForecastCard forecast={greenForecast} />);
    expect(screen.getByText('25')).toBeDefined();
  });

  it('displays "Unlimited" for null remaining', () => {
    render(<RateLimitForecastCard forecast={unlimitedForecast} />);
    expect(screen.getByText('Unlimited')).toBeDefined();
  });

  it('displays bottleneck label for known types', () => {
    render(<RateLimitForecastCard forecast={amberForecast} />);
    expect(screen.getByText('Concurrent Sessions')).toBeDefined();
  });

  it('displays "No bottleneck detected" when null', () => {
    render(<RateLimitForecastCard forecast={greenForecast} />);
    expect(screen.getByText('No bottleneck detected')).toBeDefined();
  });

  it('renders known bottleneck type', () => {
    render(<RateLimitForecastCard forecast={customBottleneck} />);
    expect(screen.getByText('Concurrent Sessions')).toBeDefined();
  });

  it('has region role for accessibility', () => {
    render(<RateLimitForecastCard forecast={greenForecast} />);
    expect(screen.getByRole('region')).toBeDefined();
  });

  it('displays "Estimated Sessions Remaining" label', () => {
    render(<RateLimitForecastCard forecast={greenForecast} />);
    expect(screen.getByText('Estimated Sessions Remaining')).toBeDefined();
  });

  it('displays "Bottleneck" label', () => {
    render(<RateLimitForecastCard forecast={amberForecast} />);
    expect(screen.getByText('Bottleneck')).toBeDefined();
  });
});
