/**
 * __tests__/InterventionStatusBadge.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InterventionStatusBadge } from '../components/session/InterventionStatusBadge';

describe('InterventionStatusBadge', () => {
  it('renders nothing when status is null', () => {
    const { container } = render(<InterventionStatusBadge status={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when status is resumed', () => {
    const { container } = render(<InterventionStatusBadge status="resumed" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders paused badge with correct label', () => {
    render(<InterventionStatusBadge status="paused" />);
    expect(screen.getByText('Paused')).toBeDefined();
  });

  it('renders intervening badge with correct label', () => {
    render(<InterventionStatusBadge status="intervening" />);
    expect(screen.getByText('Intervening')).toBeDefined();
  });

  it('shows reason as title attribute', () => {
    render(<InterventionStatusBadge status="paused" reason="security review" />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('title')).toBe('security review');
  });

  it('includes reason in aria-label', () => {
    render(<InterventionStatusBadge status="paused" reason="security review" />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe('Paused: security review');
  });

  it('applies custom className', () => {
    render(<InterventionStatusBadge status="paused" className="extra-class" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('extra-class');
  });
});
