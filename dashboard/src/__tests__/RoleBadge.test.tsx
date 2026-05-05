/**
 * __tests__/RoleBadge.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleBadge } from '../components/session/RoleBadge';

describe('RoleBadge', () => {
  const roles = ['driver', 'observer', 'operator', 'admin'] as const;

  it.each(roles)('renders %s role badge with label', (role) => {
    render(<RoleBadge role={role} />);
    const label = role.charAt(0).toUpperCase() + role.slice(1);
    expect(screen.getByText(label)).toBeDefined();
  });

  it('renders without label when showLabel is false', () => {
    const { container } = render(<RoleBadge role="driver" showLabel={false} />);
    expect(container.textContent).not.toContain('Driver');
  });

  it('has status role for accessibility', () => {
    render(<RoleBadge role="driver" />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('includes role name in aria-label', () => {
    render(<RoleBadge role="admin" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Admin');
  });

  it('applies custom className', () => {
    render(<RoleBadge role="observer" className="extra-class" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('extra-class');
  });
});
