/**
 * components/shared/EmptyState.tsx — Reusable empty state with icon, title, description, optional CTA.
 */

import type { ReactNode } from 'react';

type Variant = 'empty' | 'empty-searchable' | 'empty-error' | 'feature-unavailable';

interface EmptyStateProps {
  variant?: Variant;
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ 
  variant = 'empty',
  icon, 
  title, 
  description, 
  action, 
  className = '' 
}: EmptyStateProps) {
  const variantStyles: Record<Variant, { container: string; iconBg: string; titleColor: string }> = {
    'empty': {
      container: '',
      iconBg: 'bg-[var(--color-void-dark)]',
      titleColor: 'text-[var(--color-text-primary)]',
    },
    'empty-searchable': {
      container: '',
      iconBg: 'bg-[var(--color-void-dark)]',
      titleColor: 'text-[var(--color-text-primary)]',
    },
    'empty-error': {
      container: 'border border-red-500/20 bg-red-500/5',
      iconBg: 'bg-red-500/10',
      titleColor: 'text-red-300',
    },
    'feature-unavailable': {
      container: 'border border-amber-500/20 bg-amber-500/5',
      iconBg: 'bg-amber-500/10',
      titleColor: 'text-amber-300',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      role="status"
      aria-label={title}
      className={`flex flex-col items-center justify-center py-16 px-6 text-center rounded-lg ${styles.container} ${className}`}
    >
      {icon && (
        <div className={`mb-4 rounded-full p-3 ${styles.iconBg} text-[var(--color-text-muted)]`}>
          {icon}
        </div>
      )}
      <h3 className={`text-lg font-medium ${styles.titleColor}`}>{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-[var(--color-text-muted)]">{description}</p>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
}
