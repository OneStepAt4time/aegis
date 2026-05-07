/**
 * ErrorBoundary.test.tsx — Vitest tests for the error boundary component.
 *
<<<<<<< HEAD
 * @see #2829
=======
 * @see issue 2829
>>>>>>> docs/changelog-may-7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

// Suppress React error-boundary console noise in tests
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn((...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('The above error occurred in the React component')) return;
    if (msg.includes('Uncaught')) return;
    originalError.call(console, ...args);
  });
});

/** Component that always throws when rendered. */
function ThrowOnRender({ error }: { error?: Error }): React.ReactElement {
  throw error ?? new Error('Test error');
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).not.toBeNull();
  });

  it('shows fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).not.toBeNull();
    expect(screen.getByText('Test error')).not.toBeNull();
    expect(screen.getByRole('alert')).not.toBeNull();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<p>Custom fallback</p>}>
        <ThrowOnRender />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom fallback')).not.toBeNull();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('resets state when retry button is clicked', () => {
    let shouldThrow = true;

    function ConditionalThrow(): React.ReactElement {
      if (shouldThrow) throw new Error('boom');
      return <p>Recovered</p>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('boom')).not.toBeNull();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('Recovered')).not.toBeNull();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('displays the error message in the fallback', () => {
    const customError = new Error('Specific error message');
    render(
      <ErrorBoundary>
        <ThrowOnRender error={customError} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Specific error message')).not.toBeNull();
  });

  it('shows generic message when error has no message', () => {
    function ThrowNull(): React.ReactElement {
      throw new Error();
    }
    render(
      <ErrorBoundary>
        <ThrowNull />
      </ErrorBoundary>,
    );
    expect(screen.getByText('An unexpected error occurred')).not.toBeNull();
  });
});
