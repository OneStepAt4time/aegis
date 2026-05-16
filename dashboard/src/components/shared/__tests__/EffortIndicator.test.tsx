/**
 * EffortIndicator.test.tsx — Tests for the effort level indicator.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EffortIndicator } from '../EffortIndicator';

describe('EffortIndicator', () => {
  it('renders nothing when effort is undefined', () => {
    const { container } = render(<EffortIndicator />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when effort is null', () => {
    const { container } = render(<EffortIndicator effort={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders High for high effort', () => {
    render(<EffortIndicator effort="high" />);
    expect(screen.getByText('High')).toBeTruthy();
  });

  it('renders Med for medium effort', () => {
    render(<EffortIndicator effort="medium" />);
    expect(screen.getByText('Med')).toBeTruthy();
  });

  it('renders Low for low effort', () => {
    render(<EffortIndicator effort="low" />);
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('maps numeric 0.8 to High', () => {
    render(<EffortIndicator effort="0.8" />);
    expect(screen.getByText('High')).toBeTruthy();
  });

  it('maps numeric 0.5 to Med', () => {
    render(<EffortIndicator effort="0.5" />);
    expect(screen.getByText('Med')).toBeTruthy();
  });

  it('maps numeric 0.1 to Low', () => {
    render(<EffortIndicator effort="0.1" />);
    expect(screen.getByText('Low')).toBeTruthy();
  });

  it('renders raw value for unknown effort', () => {
    render(<EffortIndicator effort="turbo" />);
    expect(screen.getByText('turbo')).toBeTruthy();
  });

  it('shows effort in title attribute', () => {
    render(<EffortIndicator effort="high" />);
    const indicator = screen.getByText('High');
    expect(indicator.closest('[title]')?.getAttribute('title')).toBe('Effort: high');
  });
});
