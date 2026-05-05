/**
 * components/session/RoleBadge.tsx — Badge showing subscriber role (driver/observer/operator/admin).
 */

import { Gamepad2, Eye, Shield, Crown } from 'lucide-react';
import type { AcpDisplayRole } from '../../types/acp-driver-observer';
import { ROLE_COLORS } from '../../types/acp-driver-observer';

export interface RoleBadgeProps {
  role: AcpDisplayRole;
  showLabel?: boolean;
  className?: string;
}

const ROLE_ICONS: Record<AcpDisplayRole, typeof Gamepad2> = {
  driver: Gamepad2,
  observer: Eye,
  operator: Shield,
  admin: Crown,
};

const ROLE_LABELS: Record<AcpDisplayRole, string> = {
  driver: 'Driver',
  observer: 'Observer',
  operator: 'Operator',
  admin: 'Admin',
};

export function RoleBadge({ role, showLabel = true, className = '' }: RoleBadgeProps) {
  const Icon = ROLE_ICONS[role];
  const colors = ROLE_COLORS[role];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text} ${className}`}
      role="status"
      aria-label={ROLE_LABELS[role]}
    >
      <Icon className="h-3 w-3" />
      {showLabel && ROLE_LABELS[role]}
    </span>
  );
}
