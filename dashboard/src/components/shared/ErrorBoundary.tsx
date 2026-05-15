/**
 * components/shared/ErrorBoundary.tsx — React error boundary with fallback UI.
 *
 * Uses theme-aware colors via dark: variants so the fallback is
 * legible in both light and dark mode (fixes issue 2829).
 */

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          className="flex flex-col items-center justify-center gap-4 p-8 text-center"
          role="alert"
          aria-live="assertive"
        >
          <div className="rounded-full bg-[var(--color-danger)]/15 p-4 dark:bg-[var(--color-danger)]/10">
            <AlertTriangle className="h-8 w-8 text-[var(--color-danger)] dark:text-[var(--color-danger)]" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-medium text-[var(--color-danger)] dark:text-red-300">
              Something went wrong
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
          </div>
          <button type="button"
            onClick={this.handleRetry}
            className="flex items-center gap-2 rounded-lg border border-red-300 bg-[var(--color-danger)]/15 px-4 py-2 text-sm text-[var(--color-danger)] transition-colors hover:bg-red-200 dark:border-[var(--color-danger)]/30 dark:bg-[var(--color-danger)]/20 dark:text-red-300 dark:hover:bg-[var(--color-danger)]/30"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
