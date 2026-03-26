/**
 * components/ErrorBoundary.tsx — Catches render errors with a fallback UI.
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center text-center px-4">
          <div className="text-6xl mb-4">&#x26A0;</div>
          <h1 className="text-lg text-[#e0e0e0] mb-2">Something went wrong</h1>
          <p className="text-sm text-[#555] mb-6 max-w-md">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 text-sm font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
