import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalEmptyState } from '../ApprovalEmptyState';

describe('ApprovalEmptyState', () => {
  it('renders the empty state message', () => {
    render(<ApprovalEmptyState />);
    expect(screen.getByText('No sessions pending approval')).toBeDefined();
  });

  it('renders the helper text', () => {
    render(<ApprovalEmptyState />);
    expect(screen.getByText(/When a session needs your approval/)).toBeDefined();
  });
});
