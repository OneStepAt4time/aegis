/**
 * __tests__/ErrorState.test.tsx — Unit tests for the ErrorState component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '../components/ErrorState';
import type { ErrorVariant } from '../components/ErrorState';

const ALL_VARIANTS: ErrorVariant[] = [
  'offline',
  'server-5xx',
  'unauthorized',
  'rate-limited',
  'timeout',
  'not-found',
];

describe('ErrorState', () => {
  it('renders with data-testid="error-state"', () => {
    render(<ErrorState variant="offline" />);
    expect(screen.getByTestId('error-state')).toBeDefined();
  });

  it.each(ALL_VARIANTS)('renders variant "%s" with correct data-variant attribute', (variant) => {
    render(<ErrorState variant={variant} />);
    expect(screen.getByTestId('error-state').getAttribute('data-variant')).toBe(variant);
  });

  it('shows default title for offline variant', () => {
    render(<ErrorState variant="offline" />);
    expect(screen.getByText('No connection')).toBeDefined();
  });

  it('shows default title for server-5xx variant', () => {
    render(<ErrorState variant="server-5xx" />);
    expect(screen.getByText('Server error')).toBeDefined();
  });

  it('shows default title for unauthorized variant', () => {
    render(<ErrorState variant="unauthorized" />);
    expect(screen.getByText('Access denied')).toBeDefined();
  });

  it('shows default title for rate-limited variant', () => {
    render(<ErrorState variant="rate-limited" />);
    expect(screen.getByText('Slow down')).toBeDefined();
  });

  it('shows default title for timeout variant', () => {
    render(<ErrorState variant="timeout" />);
    expect(screen.getByText('Request timed out')).toBeDefined();
  });

  it('shows default title for not-found variant', () => {
    render(<ErrorState variant="not-found" />);
    expect(screen.getByText('Not found')).toBeDefined();
  });

  it('uses custom message when provided', () => {
    render(<ErrorState variant="offline" message="Custom error message" />);
    expect(screen.getByText('Custom error message')).toBeDefined();
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorState variant="offline" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders retry button when onRetry is provided', () => {
    render(<ErrorState variant="offline" onRetry={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorState variant="server-5xx" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows "Sign in again" label for unauthorized variant retry button', () => {
    render(<ErrorState variant="unauthorized" onRetry={vi.fn()} />);
    expect(screen.getByText('Sign in again')).toBeDefined();
  });

  it('shows "Retry" label for server-5xx variant retry button', () => {
    render(<ErrorState variant="server-5xx" onRetry={vi.fn()} />);
    expect(screen.getByText('Retry')).toBeDefined();
  });

  it('shows "Go back" label for not-found variant retry button', () => {
    render(<ErrorState variant="not-found" onRetry={vi.fn()} />);
    expect(screen.getByText('Go back')).toBeDefined();
  });

  it('does not use any hardcoded hex colors', () => {
    const { container } = render(<ErrorState variant="offline" onRetry={vi.fn()} />);
    const html = container.innerHTML;
    // Should not contain direct hex codes (only CSS vars are allowed)
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}(?![0-9a-fA-F])/);
  });
});
