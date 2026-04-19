/**
 * components/ErrorState.tsx — Branded error state component for Aegis.
 *
 * Variants: offline, server-5xx, unauthorized, rate-limited, timeout, not-found
 */

import { WifiOff, ServerCrash, Lock, Clock, AlertCircle, Search } from 'lucide-react';
import type { FC, ReactNode } from 'react';

export type ErrorVariant =
  | 'offline'
  | 'server-5xx'
  | 'unauthorized'
  | 'rate-limited'
  | 'timeout'
  | 'not-found';

export interface ErrorStateProps {
  variant: ErrorVariant;
  message?: string;
  onRetry?: () => void;
}

interface VariantConfig {
  icon: FC<{ className?: string }>;
  title: string;
  description: string;
  iconClass: string;
  retryLabel: string;
}

const VARIANT_CONFIG: Record<ErrorVariant, VariantConfig> = {
  offline: {
    icon: WifiOff,
    title: 'No connection',
    description: 'Aegis cannot reach the server. Check your network and try again.',
    iconClass: 'text-[var(--color-warning)]',
    retryLabel: 'Retry',
  },
  'server-5xx': {
    icon: ServerCrash,
    title: 'Server error',
    description: 'Something went wrong on the Aegis server. This is not your fault — try again in a moment.',
    iconClass: 'text-[var(--color-danger)]',
    retryLabel: 'Retry',
  },
  unauthorized: {
    icon: Lock,
    title: 'Access denied',
    description: 'Your session has expired or you do not have permission to view this resource.',
    iconClass: 'text-[var(--color-warning)]',
    retryLabel: 'Sign in again',
  },
  'rate-limited': {
    icon: Clock,
    title: 'Slow down',
    description: 'Too many requests. Aegis is throttling your access — please wait a moment before retrying.',
    iconClass: 'text-[var(--color-warning)]',
    retryLabel: 'Try again',
  },
  timeout: {
    icon: Clock,
    title: 'Request timed out',
    description: 'The server took too long to respond. It may be under load — retrying usually helps.',
    iconClass: 'text-[var(--color-text-muted)]',
    retryLabel: 'Retry',
  },
  'not-found': {
    icon: Search,
    title: 'Not found',
    description: 'The resource you are looking for does not exist or has been removed.',
    iconClass: 'text-[var(--color-text-muted)]',
    retryLabel: 'Go back',
  },
};

export function ErrorState({ variant, message, onRetry }: ErrorStateProps): ReactNode {
  const config = VARIANT_CONFIG[variant];
  const IconComponent = config.icon;

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16 px-6 text-center"
      data-testid="error-state"
      data-variant={variant}
    >
      <div className="rounded-full border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4">
        <IconComponent className={`h-8 w-8 ${config.iconClass}`} />
      </div>

      <div className="max-w-sm space-y-1">
        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
          {config.title}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          {message ?? config.description}
        </p>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          {config.retryLabel}
        </button>
      )}
    </div>
  );
}

export default ErrorState;
