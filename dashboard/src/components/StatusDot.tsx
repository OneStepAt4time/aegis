/**
 * components/StatusDot.tsx
 * Semantic status glyph — a filled Lucide `Circle` coloured from CSS variables.
 *
 * Pulse animation only on `working`. All other variants are static to preserve
 * a calm UI. Colors reference `--color-*` tokens in `index.css` — never
 * hardcoded hex — so light/dark themes continue to work.
 */

import { Circle } from 'lucide-react';
import type { CSSProperties } from 'react';

export type StatusDotVariant =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'error'
  | 'compacting'
  | 'unknown';

export interface StatusDotProps {
  variant: StatusDotVariant;
  size?: 8 | 10 | 12;
  'aria-label'?: string;
  className?: string;
}

const VARIANT_COLOR: Record<StatusDotVariant, string> = {
  idle: 'var(--color-success)',
  working: 'var(--color-warning)',
  waiting: 'var(--color-info)',
  error: 'var(--color-danger)',
  compacting: 'var(--color-accent-purple)',
  unknown: 'var(--color-text-muted)',
};

export function StatusDot({
  variant,
  size = 10,
  className,
  ...rest
}: StatusDotProps) {
  const color = VARIANT_COLOR[variant];
  const ariaLabel = rest['aria-label'] ?? `status: ${variant}`;
  const style: CSSProperties = {
    color,
    fill: color,
    animation:
      variant === 'working' ? 'pulse-intense 1.5s infinite' : undefined,
  };
  return (
    <Circle
      size={size}
      strokeWidth={0}
      className={className}
      style={style}
      role="img"
      aria-label={ariaLabel}
      data-variant={variant}
    />
  );
}

export default StatusDot;
