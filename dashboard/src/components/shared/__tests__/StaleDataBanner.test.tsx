import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StaleDataBanner } from '../StaleDataBanner';

describe('StaleDataBanner', () => {
  it('renders the warning message', () => {
    render(<StaleDataBanner error="Connection lost" />);
    expect(screen.getByText(/Live updates disconnected/)).toBeTruthy();
    expect(screen.getByText(/Connection lost/)).toBeTruthy();
  });

  it('has role=alert for accessibility', () => {
    render(<StaleDataBanner error="SSE error" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
