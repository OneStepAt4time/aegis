/**
 * components/shared/EmptyState.tsx — Reusable empty state with icon, title, description, optional CTA.
 */

import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-label={title}
      className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}
    >
      <div className="mb-4 rounded-full p-3 bg-[var(--color-void-dark)] text-[var(--color-text-muted)]">{icon}</div>
      <h3 className="text-lg font-medium text-[var(--color-text-primary)]">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
