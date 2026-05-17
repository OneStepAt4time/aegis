/**
 * EmptyState.test.tsx — Tests for shared EmptyState component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyState from '../EmptyState';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No sessions found" />);
    expect(screen.getByText('No sessions found')).toBeTruthy();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Create a session to get started" />);
    expect(screen.getByText('Create a session to get started')).toBeTruthy();
  });

  it('does not render description when omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders icon when provided', () => {
    render(<EmptyState title="Empty" icon={<span data-testid="icon">X</span>} />);
    expect(screen.getByTestId('icon')).toBeTruthy();
  });

  it('does not render icon element when omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    // The icon wrapper div should not exist
    const iconWrappers = container.querySelectorAll('.rounded-full.p-3');
    expect(iconWrappers.length).toBe(0);
  });

  it('renders action slot', () => {
    render(<EmptyState title="Empty" action={<button>Create New</button>} />);
    expect(screen.getByText('Create New')).toBeTruthy();
  });

  it('has role="status" and aria-label', () => {
    render(<EmptyState title="No data" />);
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-label')).toBe('No data');
  });

  it('applies error variant styles', () => {
    render(<EmptyState title="Error" variant="empty-error" />);
    const container = screen.getByRole('status');
    expect(container.className).toContain('border');
  });

  it('applies custom className', () => {
    render(<EmptyState title="Test" className="my-custom" />);
    const container = screen.getByRole('status');
    expect(container.className).toContain('my-custom');
  });
});
