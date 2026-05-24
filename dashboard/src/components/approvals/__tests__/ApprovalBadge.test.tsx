/**
 * ApprovalBadge.test.tsx — Tests for the pending approval count badge.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalBadge } from '../ApprovalBadge';

describe('ApprovalBadge', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(<ApprovalBadge count={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when count is negative', () => {
    const { container } = render(<ApprovalBadge count={-1} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows count when positive', () => {
    render(<ApprovalBadge count={3} />);
    expect(screen.getByText('3')).toBeDefined();
  });

  it('shows 99+ when count exceeds 99', () => {
    render(<ApprovalBadge count={150} />);
    expect(screen.getByText('99+')).toBeDefined();
  });

  it('has accessible label', () => {
    render(<ApprovalBadge count={1} />);
    expect(screen.getByLabelText('1 session awaiting approval')).toBeDefined();
  });

  it('pluralizes label for multiple sessions', () => {
    render(<ApprovalBadge count={5} />);
    expect(screen.getByLabelText('5 sessions awaiting approval')).toBeDefined();
  });
});
