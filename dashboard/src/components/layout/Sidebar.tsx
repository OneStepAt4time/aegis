/**
 * layout/Sidebar.tsx — Collapsible sidebar with nav groups, identity, and actions.
 */

import { NavLink } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Cog,
  LogOut,
  X,
} from 'lucide-react';
import { ServerHealthDot } from '../shared/ServerHealthIndicator';
import { ShieldWordmark } from '../brand/ShieldLogo';
import { useAuthStore } from '../../store/useAuthStore.js';
import { useSidebarStore } from '../../store/useSidebarStore.js';
import { useT } from '../../i18n/context';
import { NAV_GROUPS } from './types';

interface SidebarProps {
  onNavClick: () => void;
  onLogout: () => void;
  isMobileDrawerOpen: boolean;
  isMobileSidebarHidden: boolean;
  hiddenMobileSidebarControlTabIndex: number | undefined;
}

export function Sidebar({
  onNavClick,
  onLogout,
  isMobileDrawerOpen,
  isMobileSidebarHidden,
  hiddenMobileSidebarControlTabIndex,
}: SidebarProps) {
  const t = useT();
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const closeMobile = useSidebarStore((s) => s.closeMobile);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const identity = useAuthStore((s) => s.identity);

  const sidebarWidth = isCollapsed
    ? 'w-16 max-md:w-56 max-w-[calc(100vw-2rem)] md:max-w-none'
    : 'w-56 max-w-[calc(100vw-2rem)] md:max-w-none';
  const identityLabel = identity?.email ?? identity?.name ?? identity?.userId;
  const identityDetailLabel = identity ? `${identity.role} - ${identity.tenantId}` : null;

  return (
    <aside
      aria-label={t("aria.primarySidebar")}
      className={`
        fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/5 bg-transparent backdrop-blur-xl
        transition-all duration-300 ease-in-out
        ${sidebarWidth}
        ${isMobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'}
        ${isMobileSidebarHidden ? 'pointer-events-none md:pointer-events-auto' : ''}
        md:relative md:translate-x-0 md:shrink-0
        group/sidebar
      `}
      aria-hidden={isMobileSidebarHidden ? 'true' : undefined}
      inert={isMobileSidebarHidden ? true : undefined}
      style={{ backgroundImage: 'var(--sidebar-glow)' }}
    >
      <div className="flex items-center justify-between gap-3 px-6 py-6 border-b border-white/5">
        <ShieldWordmark size="md" collapsed={isCollapsed} />
        <button
          type="button"
          onClick={closeMobile}
          tabIndex={hiddenMobileSidebarControlTabIndex}
          disabled={isMobileSidebarHidden}
          className="md:hidden inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)]"
          aria-label={t("aria.closeMenu")}
          aria-hidden={isMobileSidebarHidden ? 'true' : undefined}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex flex-col gap-4 px-3 py-6 flex-1 overflow-y-auto overflow-x-hidden" aria-label={t("aria.mainNavigation")}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            {!isCollapsed && (
              <span className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] select-none">
                {group.label}
              </span>
            )}
            {group.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                tabIndex={hiddenMobileSidebarControlTabIndex}
                onClick={onNavClick}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all min-h-[44px] ${
                    isActive
                      ? 'border-l-2 border-[var(--color-accent-on-light)] bg-[var(--color-accent-on-light)]/10 text-[var(--color-accent-on-light)] dark:border-[var(--color-accent-cyan)] dark:bg-[var(--color-cta-bg)]/10 dark:text-[var(--color-accent-cyan)] glow-nav-active'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] border-l-2 border-transparent dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)]'
                  } ${isCollapsed ? 'justify-center' : ''}`
                }
                title={isCollapsed ? label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed && <span className="truncate">{label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 px-3 py-4 flex flex-col gap-2">
        {identityLabel && identityDetailLabel && !isCollapsed && (
          <div className="px-3 py-2" aria-label={t("aria.signedInUser")}>
            <p className="truncate text-xs font-medium text-[var(--color-text-primary)] dark:text-[var(--color-text-primary)]">{identityLabel}</p>
            <p className="truncate text-[11px] text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]">
              {identityDetailLabel}
            </p>
          </div>
        )}

        <NavLink
          to="/settings"
          tabIndex={hiddenMobileSidebarControlTabIndex}
          onClick={onNavClick}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all min-h-[44px] ${
              isActive
                ? 'border-l-2 border-[var(--color-accent-on-light)] bg-[var(--color-accent-on-light)]/10 text-[var(--color-accent-on-light)] dark:border-[var(--color-accent-cyan)] dark:bg-[var(--color-cta-bg)]/10 dark:text-[var(--color-accent-cyan)] glow-nav-active'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] border-l-2 border-transparent dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)]'
            } ${isCollapsed ? 'justify-center' : ''}`
          }
          title={isCollapsed ? t('nav.settings') : undefined}
        >
          <Cog className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="truncate">{t('nav.settings')}</span>}
        </NavLink>

        {!isCollapsed && <ServerHealthDot />}

        <button
          type="button"
          onClick={toggleSidebar}
          className="hidden min-h-[44px] md:flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)] transition-colors w-full"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronLeft className="h-4 w-4 shrink-0" />
          )}
          {!isCollapsed && <span className="truncate">{t('drawer.collapse')}</span>}
        </button>

        <button
          type="button"
          onClick={onLogout}
          tabIndex={hiddenMobileSidebarControlTabIndex}
          title={isCollapsed ? t('aria.signOut') : undefined}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-3 min-h-[44px] text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] dark:text-[var(--color-text-muted)] dark:hover:bg-[var(--color-void-lighter)] dark:hover:text-[var(--color-text-primary)] transition-colors w-full ${isCollapsed ? 'justify-center' : ''}`}
          aria-label={t("aria.signOut")}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!isCollapsed && <span className="truncate">{t('drawer.signOut')}</span>}
        </button>
      </div>
    </aside>
  );
}
