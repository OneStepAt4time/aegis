/**
 * components/shared/Code.tsx — Unified monospace component with proper OpenType features
 */

import { type ReactNode } from 'react';

interface CodeProps {
  children: ReactNode;
  inline?: boolean;
  lang?: string;
  className?: string;
}

export function Code({ children, inline = false, lang, className = '' }: CodeProps) {
  const baseClasses = 'font-mono tabular-nums';
  
  if (inline) {
    return (
      <code
        className={`${baseClasses} text-[length:var(--text-sm)] px-1.5 py-0.5 rounded bg-[var(--color-void-light)] text-[var(--color-text-primary)] ${className}`}
        data-numeric
      >
        {children}
      </code>
    );
  }

  return (
    <pre
      className={`${baseClasses} text-[length:var(--text-sm)] p-4 rounded-lg bg-[var(--color-void-deep)] border border-[var(--color-void-lighter)] overflow-x-auto ${className}`}
      data-lang={lang}
    >
      <code className="text-[var(--color-text-primary)]" data-numeric>
        {children}
      </code>
    </pre>
  );
}
