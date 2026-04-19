/**
 * components/Icon.tsx
 * Typed wrapper over lucide-react with a fixed size scale (12/16/20/24 px).
 *
 * Usage:
 *   <Icon name="Search" size={16} aria-label="Search" />
 *
 * - Renders nothing if `name` is not a valid Lucide export.
 * - Defaults to aria-hidden when no aria-label is supplied.
 * - strokeWidth default (1.75) matches the dashboard hairline token.
 */

import * as Lucide from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

export type IconSize = 12 | 16 | 20 | 24;

/**
 * Names of all valid Lucide icon components.
 *
 * NOTE: `keyof typeof Lucide` is large — if compile times regress we can
 * narrow this to a curated allowlist. See issue dashboard-perfection/020.
 */
export type IconName = keyof typeof Lucide;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  strokeWidth?: number;
  'aria-label'?: string;
  className?: string;
}

type LucideLike = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number }
>;

function isLucideComponent(value: unknown): value is LucideLike {
  return typeof value === 'function' || typeof value === 'object';
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
  ...rest
}: IconProps) {
  const candidate = (Lucide as Record<string, unknown>)[name as string];
  if (!candidate || !isLucideComponent(candidate)) {
    if (typeof console !== 'undefined') {
      console.warn(`[Icon] Unknown lucide-react icon: "${String(name)}"`);
    }
    return null;
  }
  const LucideIcon = candidate;
  const ariaLabel = rest['aria-label'];
  const ariaHidden = ariaLabel ? undefined : true;
  return (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={ariaHidden}
      {...rest}
    />
  );
}

export default Icon;
