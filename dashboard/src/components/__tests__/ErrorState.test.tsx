import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ErrorState } from '../ErrorState';

const variants = ['offline', 'server-5xx', 'unauthorized', 'rate-limited', 'timeout', 'not-found'] as const;

describe('ErrorState', () => {
  it.each(variants)('renders for variant "%s"', (variant) => {
    const { container } = render(<ErrorState variant={variant} />);
    expect(container.querySelector('[data-testid="error-state"]')).not.toBeNull();
    expect(container.querySelector('h2')).not.toBeNull();
  });

  it.each(variants)('has correct data-variant for "%s"', (variant) => {
    const { container } = render(<ErrorState variant={variant} />);
    expect(container.querySelector('[data-variant="' + variant + '"]')).not.toBeNull();
  });

  it('uses custom message when provided', () => {
    const { container } = render(<ErrorState variant="offline" message="Custom msg" />);
    expect(container.textContent).toContain('Custom msg');
  });

  it('uses default description when no message', () => {
    const { container } = render(<ErrorState variant="offline" />);
    expect(container.textContent).toContain('Aegis cannot reach the server');
  });

  it('renders retry button when onRetry provided', () => {
    const onRetry = vi.fn();
    const { container } = render(<ErrorState variant="offline" onRetry={onRetry} />);
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('no retry button when onRetry not provided', () => {
    const { container } = render(<ErrorState variant="offline" />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('has role="alert"', () => {
    const { container } = render(<ErrorState variant="offline" />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
