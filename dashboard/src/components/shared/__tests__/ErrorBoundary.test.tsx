import { describe, it, expect, vi, afterAll } from 'vitest';
import { render } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test crash');
  return <div>Healthy</div>;
}

describe('ErrorBoundary', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  afterAll(() => spy.mockRestore());

  it('renders children when no error', () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(container.textContent).toContain('Healthy');
  });

  it('shows fallback UI when child throws', () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('test crash');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('shows retry button after error', () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(container.querySelector('button')).not.toBeNull();
    expect(container.querySelector('button')!.textContent).toContain('Try again');
  });

  it('renders custom fallback when provided', () => {
    const { container } = render(
      <ErrorBoundary fallback={<div data-testid="custom">Oops</div>}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Something went wrong');
  });

  it('shows default message for error with empty message', () => {
    function NoMsg(): never { throw new Error(''); }
    const { container } = render(
      <ErrorBoundary>
        <NoMsg />
      </ErrorBoundary>
    );
    expect(container.textContent).toContain('An unexpected error occurred');
  });
});
