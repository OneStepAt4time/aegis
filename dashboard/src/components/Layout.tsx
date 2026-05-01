/**
 * components/Layout.tsx — Main layout with sidebar, header, and content area.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Breadcrumb from './shared/Breadcrumb';
import { ErrorBoundary } from './shared/ErrorBoundary';
import { useTheme } from '../hooks/useTheme';
import CommandPalette from './shared/CommandPalette';
import LiveAuditStream from './shared/LiveAuditStream';
import { NewSessionDrawer } from './NewSessionDrawer';
import { Sun, Moon, Plus, Search } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileText,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  RefreshCw,
  Shield,
  TrendingUp,
  Cog,
  Terminal,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore.js';
import { useSidebarStore } from '../store/useSidebarStore.js';
import { useDrawerStore } from '../store/useDrawerStore';
import { checkForUpdates, getHealth, subscribeGlobalSSE, type UpdateCheckResult } from '../api/client';
import ToastContainer from './ToastContainer';
import ConnectionBanner from './ConnectionBanner';
import { ShieldWordmark } from './brand/ShieldLogo';

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'WORKSPACE',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/sessions', label: 'Sessions', icon: Terminal },
      { to: '/templates', label: 'Templates', icon: FileText },
      { to: '/pipelines', label: 'Pipelines', icon: Activity },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/audit', label: 'Audit', icon: Shield },
      { to: '/metrics', label: 'Metrics', icon: TrendingUp },
      { to: '/cost', label: 'Cost', icon: DollarSign },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'ADMIN',
    items: [
      { to: '/auth/keys', label: 'Auth Keys', icon: KeyRound },
    ],
  },
];

const MAX_SSE_RETRIES = 5;
const SSE_RETRY_BASE_MS = 1000;
const UPDATE_CHECK_CACHE_KEY = 'aegis:update-check:v1';
const UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000;

interface CachedUpdateCheckResult extends UpdateCheckResult {
  checkedAt: number;
  sourceVersion: string;
}
const SSE_RECONNECTING_MESSAGE = 'Reconnecting to real-time updates. Overview widgets are using fallback polling where available.';
const SSE_UNAVAILABLE_MESSAGE = 'Real-time updates unavailable. Overview widgets are using fallback polling where available.';
const SSE_SUBSCRIPTION_RETRY_MESSAGE = 'Connecting real-time updates failed. Retrying now.';

export default function Layout() {
  const sseConnected = useStore((s) => s.sseConnected);
  const setSseConnected = useStore((s) => s.setSseConnected);
  const sseError = useStore((s) => s.sseError);
  const setSseError = useStore((s) => s.setSseError);
  const addActivity = useStore((s) => s.addActivity);
  const token = useStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const identity = useAuthStore((s) => s.identity);

  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const isMobileOpen = useSidebarStore((s) => s.isMobileOpen);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const toggleMobile = useSidebarStore((s) => s.toggleMobile);
  const closeMobile = useSidebarStore((s) => s.closeMobile);
  const openNewSession = useDrawerStore((s) => s.openNewSession);

  const [sseRetryCount, setSseRetryCount] = useState(0);
  const [aegisVersion, setAegisVersion] = useState<string>('...');
  const { resolvedTheme, toggleTheme } = useTheme();
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  
  function readCachedUpdate(version: string): UpdateCheckResult | null {
    try {
      const raw = localStorage.getItem(UPDATE_CHECK_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw) as CachedUpdateCheckResult;
      if (cached.sourceVersion !== version) return null;
      if (Date.now() - cached.checkedAt > UPDATE_CHECK_TTL_MS) return null;
      return {
        currentVersion: cached.currentVersion,
        latestVersion: cached.latestVersion,
        updateAvailable: cached.updateAvailable,
        releaseUrl: cached.releaseUrl,
      };
    } catch {
      return null;
    }
  }

  function writeCachedUpdate(version: string, result: UpdateCheckResult): void {
    try {
      const payload: CachedUpdateCheckResult = {
        ...result,
        checkedAt: Date.now(),
        sourceVersion: version,
      };
      localStorage.setItem(UPDATE_CHECK_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures (private mode/quota) and keep runtime behavior.
    }
  }

  async function runUpdateCheck(version: string, force: boolean): Promise<void> {
    if (!version || version === '...' || version === 'unknown') return;

    if (!force) {
      const cached = readCachedUpdate(version);
      if (cached) {
        setUpdateResult(cached);
        setUpdateCheckError(null);
        return;
      }
    }

    setUpdateCheckLoading(true);
    setUpdateCheckError(null);
    try {
      const result = await checkForUpdates(version);
      setUpdateResult(result);
      writeCachedUpdate(version, result);
    } catch (err) {
      setUpdateCheckError(err instanceof Error ? err.message : 'Failed to check updates');
      setUpdateResult(null);
    } finally {
      setUpdateCheckLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    const loadVersion = async () => {
      try {
        const health = await getHealth();
        if (!cancelled) {
          setAegisVersion(health.version);
          void runUpdateCheck(health.version, false);
        }
      } catch (err) {
        console.warn('Failed to load Aegis version', err);
        if (!cancelled) setAegisVersion('unknown');
      }
    };

    void loadVersion();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckUpdates = async () => {
    await runUpdateCheck(aegisVersion, true);
  };

  // Cmd+K global shortcut to open command palette (desktop only)
  useEffect(() => {
    // Only register keyboard shortcut on non-touch devices
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) return undefined;

    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Cmd+N global shortcut to open new session drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        const target = e.target as HTMLElement;
        const isInput =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable;
        if (!isInput) {
          e.preventDefault();
          openNewSession();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openNewSession]);

  // #121: Wire up global SSE connection
  // #587: Wrap in try/catch with retry to prevent app crash and auto-recover

  // #2352: Escape closes mobile nav drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        closeMobile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMobileOpen, closeMobile]);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function attemptConnect(attempt: number): void {
      if (cancelled) return;

      try {
        unsubscribe = subscribeGlobalSSE((event) => {
          if (!event.sessionId) return;
          addActivity(event);
        }, token, {
          onOpen: () => {
            setSseConnected(true);
            setSseError(null);
            setSseRetryCount(0);
          },
          onReconnecting: (attempt) => {
            setSseConnected(false);
            setSseRetryCount(attempt);
            setSseError(SSE_RECONNECTING_MESSAGE);
          },
          onClose: () => {
            setSseConnected(false);
          },
          onGiveUp: () => {
            setSseRetryCount(0);
            setSseError(SSE_UNAVAILABLE_MESSAGE);
            setSseConnected(false);
          },
        });
      } catch (err) {
        console.error('Failed to subscribe to global SSE (attempt %d):', attempt + 1, err);
        setSseConnected(false);

        if (attempt < MAX_SSE_RETRIES) {
          const delay = SSE_RETRY_BASE_MS * Math.pow(2, attempt);
          setSseRetryCount(attempt + 1);
          setSseError(SSE_SUBSCRIPTION_RETRY_MESSAGE);
          retryTimer = setTimeout(() => attemptConnect(attempt + 1), delay);
        } else {
          setSseRetryCount(0);
          setSseError(SSE_UNAVAILABLE_MESSAGE);
          setSseConnected(false);
        }
      }
    }

    attemptConnect(0);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unsubscribe?.();
    };
  }, [setSseConnected, setSseError, addActivity, token]);

  const sseIndicatorLabel = sseConnected
    ? 'SSE Live'
    : sseError
      ? sseRetryCount > 0
        ? `SSE Reconnecting (retry ${sseRetryCount})`
        : 'SSE Degraded'
      : 'SSE Off';

  function handleNavClick(): void {
    if (isMobileOpen) {
      toggleMobile();
    }
  }

  function handleLogout(): void {
    void logout();
  }

  const sidebarWidth = isCollapsed ? 'w-16' : 'w-56';
  const identityLabel = identity?.email ?? identity?.name ?? identity?.userId;
  const identityDetailLabel = identity ? `${identity.role} - ${identity.tenantId}` : null;


  return (
    <div className="flex h-screen overflow-hidden bg-void">
      {/* Skip-to-content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-[var(--color-accent-cyan)] focus:text-[var(--color-void-deep)] focus:px-4 focus:py-2 focus:rounded focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      {/* ── Mobile backdrop ─────────────────────────────────── */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={closeMobile} role="button" tabIndex={-1}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/5 bg-transparent backdrop-blur-xl
          transition-all duration-300 ease-in-out
          ${sidebarWidth}
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:shrink-0
          group/sidebar
        `}
        style={{ backgroundImage: 'var(--sidebar-glow)' }}
      >
        <div className="flex items-center gap-3 px-6 py-6 border-b border-white/5">
          <ShieldWordmark size="md" collapsed={isCollapsed} />
          {/* Mobile close button */}
          <button
            type="button"
            onClick={closeMobile}
            className="ml-auto md:hidden inline-flex items-center justify-center rounded-lg p-1.5 text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex flex-col gap-4 px-3 py-6 flex-1 overflow-y-auto overflow-x-hidden" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              {!isCollapsed && (
                <span className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 select-none">
                  {group.label}
                </span>
              )}
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all min-h-[44px] ${
                      isActive
                        ? 'border-l-2 border-[var(--color-accent-on-light)] bg-[var(--color-accent-on-light)]/10 text-[var(--color-accent-on-light)] dark:border-cyan dark:bg-cyan/10 dark:text-cyan glow-nav-active'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l-2 border-transparent dark:text-gray-400 dark:hover:bg-void-lighter dark:hover:text-gray-200'
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

        {/* Bottom section: Settings + toggle + logout */}
        <div className="border-t border-white/5 px-3 py-4 flex flex-col gap-2">
          {identityLabel && identityDetailLabel && !isCollapsed && (
            <div className="px-3 py-2" aria-label="Signed in user">
              <p className="truncate text-xs font-medium text-slate-700 dark:text-gray-200">{identityLabel}</p>
              <p className="truncate text-[11px] text-slate-500 dark:text-gray-500">
                {identityDetailLabel}
              </p>
            </div>
          )}

          {/* Settings link */}
          <NavLink
            to="/settings"
            onClick={handleNavClick}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all min-h-[44px] ${
                isActive
                  ? 'border-l-2 border-[var(--color-accent-on-light)] bg-[var(--color-accent-on-light)]/10 text-[var(--color-accent-on-light)] dark:border-cyan dark:bg-cyan/10 dark:text-cyan glow-nav-active'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l-2 border-transparent dark:text-gray-400 dark:hover:bg-void-lighter dark:hover:text-gray-200'
              } ${isCollapsed ? 'justify-center' : ''}`
            }
            title={isCollapsed ? 'Settings' : undefined}
          >
            <Cog className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="truncate">Settings</span>}
          </NavLink>

          {/* Collapse toggle — desktop only */}
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden md:flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-gray-400 dark:hover:bg-void-lighter dark:hover:text-gray-200 transition-colors w-full"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronLeft className="h-4 w-4 shrink-0" />
            )}
            {!isCollapsed && <span className="truncate">Collapse</span>}
          </button>

          {/* Logout */}
          <button
            type="button"
            onClick={handleLogout}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-3 min-h-[44px] text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-gray-400 dark:hover:bg-void-lighter dark:hover:text-gray-200 transition-colors w-full ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'Sign out' : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span className="truncate">Sign out</span>}
          </button>
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
        {/* Header */}
        <header className="shrink-0 border-b border-white/5 bg-transparent backdrop-blur-md px-4 py-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {/* Hamburger — mobile only */}
              <button
                type="button"
                onClick={toggleMobile} role="button" tabIndex={-1}
                className="md:hidden inline-flex items-center justify-center rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-gray-400 dark:hover:bg-void-lighter dark:hover:text-gray-200 transition-colors"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <Breadcrumb />
              </div>
            </div>

            <div className={`flex items-center justify-end gap-1.5 sm:gap-3 transition-opacity ${isMobileOpen ? "pointer-events-none opacity-30" : ""}`}>
              {/* PREVIEW badge — hidden on very small screens */}
              <span className="hidden sm:inline-flex rounded-md border border-transparent bg-blue-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-blue-800 ring-1 ring-blue-200 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-0">
                PREVIEW
              </span>

              {/* New Session button */}
              <button
                type="button"
                onClick={openNewSession}
                aria-label="New Session (⌘N)"
                title="New Session (⌘N)"
                className="inline-flex items-center justify-center rounded-lg p-2.5 min-h-[44px] min-w-[44px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-gray-400 dark:hover:bg-void-lighter dark:hover:text-gray-200 transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>

              {/* Cmd+K Palette trigger — hidden on mobile */}
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="hidden sm:inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-300 transition-all"
              >
                <Search className="h-3 w-3" />
                <span>Search…</span>
                <kbd className="ml-1 font-mono text-[10px] text-slate-600 border border-white/10 rounded px-1">⌘K</kbd>
              </button>

              {/* Version + theme toggle */}
              <div className="inline-flex items-center gap-1 sm:gap-2 rounded-md border border-slate-200 bg-white px-1.5 py-1 sm:px-2 text-xs text-slate-700 dark:border-void-lighter dark:bg-void dark:text-gray-300">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="rounded p-2 sm:p-2.5 min-h-[44px] min-w-[44px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-400 dark:hover:bg-void-lighter dark:hover:text-zinc-200"
                  aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
                <span className="hidden sm:inline truncate">Version {aegisVersion}</span>
              </div>

              {/* Check updates — hidden on mobile */}
              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={updateCheckLoading || aegisVersion === '...'}
                className="hidden sm:inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-void-lighter dark:text-gray-300 dark:hover:bg-void-lighter disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${updateCheckLoading ? 'animate-spin' : ''}`} />
                {updateCheckLoading ? 'Checking…' : 'Check updates'}
              </button>

              {updateResult && (
                <div className="hidden text-xs text-gray-400 sm:block">
                  {updateResult.updateAvailable ? (
                    <a
                      href={updateResult.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan hover:underline"
                    >
                      Update available: v{updateResult.latestVersion}
                    </a>
                  ) : (
                    <span>Up to date (v{updateResult.currentVersion})</span>
                  )}
                </div>
              )}

              {updateCheckError && (
                <div className="hidden sm:block text-xs text-amber-500" title={updateCheckError}>
                  Update check failed
                </div>
              )}
              {/* SSE status removed from header — see Status Footer below */}
            </div>
          </div>
        </header>

        {/* Content + LiveAuditStream side rail */}
        <div className="flex flex-1 overflow-hidden">
          <main id="main-content" className="flex-1 overflow-auto overscroll-contain p-3 sm:p-6 md:p-10 transition-all duration-500 animate-slide-in">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
          <LiveAuditStream />
        </div>

        {/* ── Status Footer ────────────────────────────────────── */}
        <footer className="shrink-0 border-t border-white/5 bg-transparent backdrop-blur-md px-3 py-2 sm:px-6 flex items-center justify-between gap-2">
          {/* Left: SSE connectivity */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0" title={sseError ?? undefined}>
            {sseError ? (
              <>
                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                <span className="text-[11px] text-amber-500 truncate">{sseIndicatorLabel}</span>
              </>
            ) : (
              <>
                <span
                  className={`status-dot shrink-0 ${sseConnected ? 'status-dot--idle' : ''}`}
                  style={sseConnected ? undefined : { backgroundColor: '#666' }}
                />
                <span className="text-[11px] text-slate-500 truncate">{sseIndicatorLabel}</span>
              </>
            )}
          </div>

          {/* Center: version — hidden on very small screens */}
          <span className="hidden sm:block text-[11px] text-slate-600 font-mono">aegis v{aegisVersion}</span>

          {/* Right: keyboard hint — desktop only */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-400 transition-colors"
          >
            <kbd className="font-mono text-[10px] border border-white/10 bg-white/5 rounded px-1">⌘K</kbd>
            Command palette
          </button>

          {/* Mobile: compact version on the right */}
          <span className="sm:hidden text-[11px] text-slate-600 font-mono truncate">v{aegisVersion}</span>
        </footer>
      </div>
      {/* Toast notifications */}
      <ToastContainer />
      {/* Connection banner (SSE/WS disconnect) */}
      <ConnectionBanner />
      {/* Command Palette */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      {/* New Session Drawer */}
      <NewSessionDrawer />
    </div>
  );
}
