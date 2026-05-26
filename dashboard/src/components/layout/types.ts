/**
 * layout/types.ts — Shared types and constants for Layout components.
 */

import type { ElementType } from 'react';
import {
  Activity,
  Calendar,
  BarChart3,
  DollarSign,
  FileText,
  KeyRound,
  LayoutDashboard,
  Shield,
  TrendingUp,
  Terminal,
  Radio,
  MessageCircle,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: ElementType;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'WORKSPACE',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/sessions', label: 'Sessions', icon: Terminal },
      { to: '/templates', label: 'Templates', icon: FileText },
      { to: '/pipelines', label: 'Pipelines', icon: Activity },
      { to: '/routines', label: 'Routines', icon: Calendar },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/audit', label: 'Audit', icon: Shield },
      { to: '/metrics', label: 'Metrics', icon: TrendingUp },
      { to: '/cost', label: 'Cost', icon: DollarSign },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/activity', label: 'Activity', icon: Radio },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { to: '/auth/keys', label: 'Auth Keys', icon: KeyRound },
      { to: '/settings/notifications', label: 'Notifications', icon: MessageCircle },
    ],
  },
];

export const MAX_SSE_RETRIES = 5;
export const SSE_RETRY_BASE_MS = 1000;
export const UPDATE_CHECK_CACHE_KEY = 'aegis:update-check:v1';
export const UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000;
export const SSE_RECONNECTING_MESSAGE = 'Reconnecting to real-time updates. Overview widgets are using fallback polling where available.';
export const SSE_UNAVAILABLE_MESSAGE = 'Real-time updates unavailable. Overview widgets are using fallback polling where available.';
export const SSE_SUBSCRIPTION_RETRY_MESSAGE = 'Connecting real-time updates failed. Retrying now.';
export const MOBILE_SIDEBAR_QUERY = '(max-width: 767px)';
