import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LastUpdatedIndicator } from '../LastUpdatedIndicator';

describe('LastUpdatedIndicator', () => {
  it('renders relative time text', () => {
    render(<LastUpdatedIndicator relativeTime="12s ago" isStale={false} />);
    expect(screen.getByText(/12s ago/)).toBeTruthy();
  });

  it('shows stale styling when isStale is true', () => {
    const { container } = render(<LastUpdatedIndicator relativeTime="45s ago" isStale={true} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows normal styling when fresh', () => {
    const { container } = render(<LastUpdatedIndicator relativeTime="just now" isStale={false} />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('has role=status for accessibility', () => {
    render(<LastUpdatedIndicator relativeTime="5s ago" isStale={false} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
