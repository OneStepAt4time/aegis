/**
 * components/Icon.tsx
 * Typed wrapper over lucide-react with a fixed size scale (12/16/20/24 px).
 *
 * Uses an explicit allowlist of imported icons to keep tree-shaking effective.
 * If a new icon name is needed, add it to the ICON_MAP below.
 *
 * Usage:
 *   <Icon name="Search" size={16} aria-label="Search" />
 *
 * - Renders nothing if `name` is not in the allowlist.
 * - Defaults to aria-hidden when no aria-label is supplied.
 * - strokeWidth default (1.75) matches the dashboard hairline token.
 */

import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DollarSign,
  Download,
  FileText,
  Gauge,
  Layers,
  Link,
  Search,
  Shield,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

export type IconSize = 12 | 16 | 20 | 24;

/**
 * Names of all valid Lucide icon components.
 * Keep in sync with the allowlist imports above.
 */
export type IconName =
  | 'Activity'
  | 'Check'
  | 'ChevronDown'
  | 'ChevronRight'
  | 'Copy'
  | 'DollarSign'
  | 'Download'
  | 'FileText'
  | 'Gauge'
  | 'Layers'
  | 'Link'
  | 'Search'
  | 'Shield'
  | 'Wifi'
  | 'X'
  | 'Zap';

type LucideLike = ComponentType<
  SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number }
>;

const ICON_MAP: Record<IconName, LucideLike> = {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DollarSign,
  Download,
  FileText,
  Gauge,
  Layers,
  Link,
  Search,
  Shield,
  Wifi,
  X,
  Zap,
};

export interface IconProps {
  name: IconName;
  size?: IconSize;
  strokeWidth?: number;
  'aria-label'?: string;
  className?: string;
}

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
  ...rest
}: IconProps) {
  const LucideIcon = ICON_MAP[name];
  if (!LucideIcon) {
    if (typeof console !== 'undefined') {
      console.warn(`[Icon] Unknown icon: "${name}". Add it to Icon.tsx allowlist.`);
    }
    return null;
  }
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
